require('dotenv').config();
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Banco (Neon) com SSL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Configuração de Upload (MEMÓRIA RAM - Resolve erro 500 no Render)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- INICIALIZAÇÃO: CRIA A TABELA AUTOMATICAMENTE ---
pool.query(`
    CREATE TABLE IF NOT EXISTS veiculos (
        id SERIAL PRIMARY KEY,
        placa TEXT,
        marca TEXT,
        modelo TEXT,
        ano TEXT,
        cor TEXT,
        km TEXT,
        portas TEXT,
        loja TEXT,
        valor NUMERIC
    )
`).then(() => console.log("Tabela 'veiculos' verificada com sucesso."))
  .catch(err => console.error("Erro ao verificar tabela:", err));


// Rota Principal
app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT 1 FROM veiculos LIMIT 1');
        res.render('index', { dadosCarregados: result.rowCount > 0 });
    } catch (error) {
        console.error("Erro de conexão:", error);
        res.render('index', { dadosCarregados: false });
    }
});

// Rota de Upload (Blindada)
app.post('/upload', upload.single('planilha'), async (req, res) => {
    if (!req.file) return res.status(400).send("Nenhum arquivo enviado.");

    const client = await pool.connect();

    try {
        // Lê o arquivo direto da memória
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const dadosBrutos = xlsx.utils.sheet_to_json(sheet);

        await client.query('BEGIN');
        await client.query('DELETE FROM veiculos'); // Limpa estoque antigo

        const insertQuery = `
            INSERT INTO veiculos (placa, marca, modelo, ano, cor, km, portas, loja, valor)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

        for (const item of dadosBrutos) {
            // Tratamento de valor (R$)
            let valorLimpo = 0;
            if (item['Venda']) {
                let v = item['Venda'].toString().replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
                valorLimpo = parseFloat(v);
            }
            
            const modeloCompleto = `${item['Modelo'] || ''} ${item['Versao'] || ''}`.trim();

            const valores = [
                (item['Placa'] || '').toString().toUpperCase().replace('-', '').trim(),
                item['Marca'] || '',
                modeloCompleto || '',
                item['Ano Mod'] || item['Ano Fab'] || '',
                item['Cor'] || '',
                item['Km'] || '',
                item['Prt'] || '',
                item['Local'] || 'DS Multimarcas',
                valorLimpo || 0
            ];

            await client.query(insertQuery, valores);
        }

        await client.query('COMMIT');
        console.log(`Sucesso: ${dadosBrutos.length} veículos carregados.`);
        res.redirect('/');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("ERRO NO UPLOAD:", error); // Isso aparecerá nos logs do Render
        res.status(500).send(`Erro ao processar: ${error.message}`);
    } finally {
        client.release();
    }
});

// Rota de Busca Inteligente (Placa OU Modelo)
app.post('/buscar', async (req, res) => {
    let termo = (req.body.termo || '').trim().toUpperCase();
    let termoLimpo = termo.replace('-', ''); // Para busca de placa

    try {
        // 1. Tenta achar PLACA EXATA
        const buscaPlaca = await pool.query('SELECT * FROM veiculos WHERE placa = $1', [termoLimpo]);
        
        if (buscaPlaca.rows.length > 0) {
            // Achou placa exata: retorna tipo ÚNICO
            return res.json({ type: 'unico', data: formatarVeiculo(buscaPlaca.rows[0]) });
        }

        // 2. Se não for placa, busca por MODELO ou MARCA (contendo o texto)
        const buscaModelo = await pool.query(
            'SELECT * FROM veiculos WHERE modelo ILIKE $1 OR marca ILIKE $1 ORDER BY modelo ASC', 
            [`%${termo}%`]
        );

        if (buscaModelo.rows.length > 0) {
            // Achou lista de carros: retorna tipo LISTA
            const listaFormatada = buscaModelo.rows.map(formatarVeiculo);
            return res.json({ type: 'lista', data: listaFormatada });
        }

        // 3. Não achou nada
        return res.json({ type: 'vazio' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro na busca" });
    }
});

// Rota Reset
app.get('/reset', async (req, res) => {
    try { await pool.query('DELETE FROM veiculos'); } catch(e){}
    res.redirect('/');
});

// Função auxiliar para formatar os dados bonitinho
function formatarVeiculo(data) {
    return {
        Placa: data.placa, // Importante para o clique na lista
        Marca: data.marca,
        Modelo: data.modelo,
        Ano: data.ano,
        Cor: data.cor,
        Km: data.km,
        Portas: data.portas,
        Loja: data.loja,
        Valor: data.valor
    };
}

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});