require('dotenv').config();
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Banco de Dados (Neon)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// MUDANÇA IMPORTANTE: Usar Memória ao invés de Disco
// Isso evita o erro de "pasta não encontrada" no Render
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Rota Principal
app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT 1 FROM veiculos LIMIT 1');
        const temDados = result.rowCount > 0;
        res.render('index', { dadosCarregados: temDados });
    } catch (error) {
        console.error("Erro ao conectar no Neon:", error);
        // Se der erro de conexão, renderiza a página mas assume que não tem dados
        res.render('index', { dadosCarregados: false });
    }
});

// Rota de Upload
app.post('/upload', upload.single('planilha'), async (req, res) => {
    if (!req.file) return res.redirect('/');

    const client = await pool.connect();

    try {
        // LEITURA DO ARQUIVO DIRETO DA MEMÓRIA (BUFFER)
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const dadosBrutos = xlsx.utils.sheet_to_json(sheet);

        await client.query('BEGIN');

        // Limpa o banco antigo
        await client.query('DELETE FROM veiculos');

        const insertQuery = `
            INSERT INTO veiculos (placa, marca, modelo, ano, cor, km, portas, loja, valor)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

        for (const item of dadosBrutos) {
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
        console.log(`Sucesso! ${dadosBrutos.length} veículos importados.`);
        res.redirect('/');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro CRÍTICO no upload:", error); // Isso vai aparecer nos Logs do Render
        res.status(500).send("Erro ao processar arquivo. Verifique se a planilha está correta.");
    } finally {
        client.release();
    }
});

// Rota de Busca
app.post('/buscar', async (req, res) => {
    const placaBuscada = (req.body.placa || '').toUpperCase().replace('-', '').trim();
    
    try {
        const result = await pool.query('SELECT * FROM veiculos WHERE placa = $1', [placaBuscada]);
        const data = result.rows[0];

        if (data) {
            const veiculoFormatado = {
                Marca: data.marca,
                Modelo: data.modelo,
                Ano: data.ano,
                Cor: data.cor,
                Km: data.km,
                Portas: data.portas,
                Loja: data.loja,
                Valor: data.valor
            };
            res.json(veiculoFormatado);
        } else {
            res.json(null);
        }
    } catch (err) {
        console.error(err);
        res.json(null);
    }
});

app.get('/reset', async (req, res) => {
    try {
        await pool.query('DELETE FROM veiculos');
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

app.listen(PORT, () => {
    console.log(`Rodando na porta ${PORT}`);
});