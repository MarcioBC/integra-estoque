require('dotenv').config();
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const bodyParser = require('body-parser');
const fs = require('fs');
const { Pool } = require('pg'); // Cliente oficial do Postgres

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração da Conexão com o Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Necessário para conexão segura com Neon
    }
});

const upload = multer({ dest: 'uploads/' });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Rota Principal
app.get('/', async (req, res) => {
    try {
        // Busca se existe algum veículo cadastrado
        // LIMIT 1 é só para checar se tem dados rápido
        const result = await pool.query('SELECT 1 FROM veiculos LIMIT 1');
        const temDados = result.rowCount > 0;
        
        res.render('index', { dadosCarregados: temDados });
    } catch (error) {
        console.error("Erro ao conectar no Neon:", error);
        res.render('index', { dadosCarregados: false });
    }
});

// Rota de Upload (Com Transação para segurança)
app.post('/upload', upload.single('planilha'), async (req, res) => {
    if (!req.file) return res.redirect('/');

    const client = await pool.connect(); // Pega uma conexão do pool

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const dadosBrutos = xlsx.utils.sheet_to_json(sheet);

        // Inicia uma Transação (Ou grava tudo ou não grava nada)
        await client.query('BEGIN');

        // 1. Limpa o banco antigo
        await client.query('DELETE FROM veiculos');

        // 2. Insere os novos dados
        const insertQuery = `
            INSERT INTO veiculos (placa, marca, modelo, ano, cor, km, portas, loja, valor)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

        for (const item of dadosBrutos) {
            // Tratamento de dados igual fizemos antes
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

        // Confirma a gravação (Commit)
        await client.query('COMMIT');
        
        console.log(`Sucesso! ${dadosBrutos.length} veículos importados para o Neon.`);
        
        // Remove arquivo temporário
        fs.unlinkSync(req.file.path);
        res.redirect('/');

    } catch (error) {
        // Se der erro, desfaz tudo (Rollback)
        await client.query('ROLLBACK');
        console.error("Erro no processamento:", error);
        res.send("Erro ao processar arquivo. Tente novamente.");
    } finally {
        client.release(); // Libera a conexão
    }
});

// Rota de Busca
app.post('/buscar', async (req, res) => {
    const placaBuscada = (req.body.placa || '').toUpperCase().replace('-', '').trim();
    
    try {
        const result = await pool.query('SELECT * FROM veiculos WHERE placa = $1', [placaBuscada]);
        const data = result.rows[0]; // Pega o primeiro resultado

        if (data) {
            // Formata para o Front-end
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

// Rota Reset
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