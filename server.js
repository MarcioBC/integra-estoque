const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

// Armazenamento em memória
let dadosPlanilha = [];
let dadosCarregados = false;

// --- FUNÇÃO AUXILIAR: LIMPA O TEXTO ---
function limparChave(chave) {
    if(!chave) return "";
    return chave.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// --- FUNÇÃO AUXILIAR: CONVERTE DINHEIRO PARA NÚMERO ---
function tratarValorDinheiro(valorBruto) {
    if (!valorBruto) return 0;
    if (typeof valorBruto === 'number') return valorBruto;

    let v = valorBruto.toString();
    // Remove R$ e espaços
    v = v.replace("R$", "").trim();
    
    // Lógica para detectar se é 30.000,00 ou 30000
    if (v.includes(',') && v.includes('.')) {
        v = v.replace(/\./g, '').replace(',', '.'); // Padrao BR: Tira ponto milhar, mantem virgula decimal
    } else if (v.includes(',')) {
        v = v.replace(',', '.'); // Apenas decimal
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
            
            // 1. Limpa nomes das colunas
            Object.keys(row).forEach(key => {
                const keyLimpa = limparChave(key);
                colunasLimpas[keyLimpa] = row[key];
                newRow[keyLimpa] = row[key]; // Salva limpo
                newRow[key] = row[key];      // Salva original
            });

            // 2. DETETIVE DE PREÇO: Procura a coluna certa
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

// --- BUSCA INTELIGENTE (FILTRO DE FAIXA + ORDENAÇÃO) ---
app.post('/buscar', (req, res) => {
    const termoOriginal = req.body.termo || '';
    const termo = termoOriginal.toLowerCase().trim();
    
    // Verifica se é busca numérica (Filtro de Preço)
    const termoNumerico = parseFloat(termo.replace(/[^0-9]/g, ''));
    const isNumero = !isNaN(termoNumerico) && termo.match(/\d/) && !termo.match(/[a-z]/);

    let resultados = [];

    if (isNumero && termoNumerico > 0) {
        // Lógica de Faixas
        let base = termoNumerico;
        if (base < 100) base = base * 1000; // Se digitou "30", vira "30000"

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
        // Busca Texto (Placa, Modelo)
        resultados = dadosPlanilha.filter(item => {
            return Object.values(item).some(val => 
                String(val).toLowerCase().includes(termo)
            );
        });
    }

    // --- ORDENAÇÃO MÁGICA AQUI ---
    // Organiza do MENOR preço para o MAIOR preço
    resultados.sort((a, b) => {
        return (a.valor_tratado || 0) - (b.valor_tratado || 0);
    });

    if (resultados.length === 1) res.json({ type: 'unico', data: resultados[0] });
    else if (resultados.length > 1) res.json({ type: 'lista', data: resultados });
    else res.json({ type: 'nenhum' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));