const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const https = require('https');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

// --- SISTEMA ANTI-SONO COM HORÁRIO COMERCIAL (07:50 às 18:00) ---
// ⚠️ COLOQUE SEU LINK ABAIXO:
const MINHA_URL = 'https://SEU-SITE-AQUI.onrender.com'; 

if (MINHA_URL.includes('onrender.com')) {
    console.log(`⏰ Sistema de Horário Comercial configurado para: ${MINHA_URL}`);
    
    setInterval(() => {
        // Pega a hora certa no Brasil (São Paulo)
        const agora = new Date();
        const dataBR = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
        
        const hora = dataBR.getHours();
        const minutos = dataBR.getMinutes();
        
        // Transforma tudo em minutos para facilitar a conta
        // Ex: 07:50 = (7 * 60) + 50 = 470 minutos
        const tempoAtual = (hora * 60) + minutos;
        const inicioDia = (7 * 60) + 50; // 07:50
        const fimDia = (18 * 60);        // 18:00

        // Lógica: Só pinga se estiver dentro do horário
        if (tempoAtual >= inicioDia && tempoAtual < fimDia) {
            console.log(`[${hora}:${minutos}] ☀️ Dia de trabalho! Mantendo site acordado...`);
            https.get(MINHA_URL, (res) => {
                // Ping silencioso, apenas para manter ativo
            }).on('error', (e) => {
                console.error(`Erro no ping: ${e.message}`);
            });
        } else {
            console.log(`[${hora}:${minutos}] 🌙 Fora do expediente. Deixando o sistema dormir.`);
        }

    }, 10 * 60 * 1000); // Verifica a cada 10 minutos
}
// -------------------------------------------------------------

// Armazenamento em memória
let dadosPlanilha = [];
let dadosCarregados = false;

function limparChave(chave) {
    if(!chave) return "";
    return chave.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tratarValorDinheiro(valorBruto) {
    if (!valorBruto) return 0;
    if (typeof valorBruto === 'number') return valorBruto;

    let v = valorBruto.toString();
    v = v.replace("R$", "").trim();
    
    if (v.includes(',') && v.includes('.')) {
        v = v.replace(/\./g, '').replace(',', '.'); 
    } else if (v.includes(',')) {
        v = v.replace(',', '.'); 
    }
    
    return parseFloat(v) || 0;
}

app.get('/', (req, res) => {
    res.render('index', { dadosCarregados });
});

app.get('/reset', (req, res) => {
    dadosPlanilha = [];
    dadosCarregados = false;
    res.redirect('/');
});

app.post('/upload', upload.single('planilha'), (req, res) => {
    if (!req.file) return res.send('Erro: Nenhuma planilha enviada.');

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData = xlsx.utils.sheet_to_json(sheet);
        
        dadosPlanilha = rawData.map(row => {
            const newRow = {};
            const colunasLimpas = {};
            
            Object.keys(row).forEach(key => {
                const keyLimpa = limparChave(key);
                colunasLimpas[keyLimpa] = row[key];
                newRow[keyLimpa] = row[key];
                newRow[key] = row[key];
            });

            let valorEncontrado = 0;
            const possiveisNomes = ['valor', 'preco', 'venda', 'vlr', 'total', 'anuncio'];
            
            for (let possivel of possiveisNomes) {
                const chaveReal = Object.keys(colunasLimpas).find(k => k.includes(possivel));
                if (chaveReal) {
                    valorEncontrado = tratarValorDinheiro(colunasLimpas[chaveReal]);
                    break;
                }
            }
            newRow['valor_tratado'] = valorEncontrado; 
            return newRow;
        });

        dadosCarregados = true;
        fs.unlinkSync(req.file.path);
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.send('Erro ao processar planilha.');
    }
});

app.post('/buscar', (req, res) => {
    const termoOriginal = req.body.termo || '';
    const termo = termoOriginal.toLowerCase().trim();
    
    const termoNumerico = parseFloat(termo.replace(/[^0-9]/g, ''));
    const isNumero = !isNaN(termoNumerico) && termo.match(/\d/) && !termo.match(/[a-z]/);

    let resultados = [];

    if (isNumero && termoNumerico > 0) {
        let base = termoNumerico;
        if (base < 100) base = base * 1000;

        let milharBase = Math.floor(base / 10000) * 10000; 
        let min = 0, max = 0;

        if (milharBase === 10000) {      
            min = 10000; max = 20000;
        } else if (milharBase >= 20000 && milharBase < 60000) { 
            min = milharBase + 1000; max = milharBase + 10000;
        } else if (milharBase >= 60000) { 
            min = 61000; max = 9999999;
        } else {
            min = base - 5000; max = base + 5000;
        }

        resultados = dadosPlanilha.filter(item => {
            return item['valor_tratado'] >= min && item['valor_tratado'] <= max;
        });

    } else {
        resultados = dadosPlanilha.filter(item => {
            return Object.values(item).some(val => 
                String(val).toLowerCase().includes(termo)
            );
        });
    }

    resultados.sort((a, b) => {
        return (a.valor_tratado || 0) - (b.valor_tratado || 0);
    });

    if (resultados.length === 1) res.json({ type: 'unico', data: resultados[0] });
    else if (resultados.length > 1) res.json({ type: 'lista', data: resultados });
    else res.json({ type: 'nenhum' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));