const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); 
const path = require('path');
const fs = require('fs'); 
const { execSync } = require('child_process'); 
const CryptoJS = require('crypto-js'); // Import da biblioteca

// 🔥 DICA: Mude esta chave para algo muito específico seu. 
// Se você mudar essa chave no futuro, todos os clientes atuais perderão a licença.
const CHAVE_SECRETA = 'MinhaChaveSecretaDoCartorioControl123'; 

// ===================================================
// FUNÇÕES AUXILIARES DE CRIPTOGRAFIA
// ===================================================
function salvarLicencaCriptografada(caminho, dados) {
  const textoCifrado = CryptoJS.AES.encrypt(JSON.stringify(dados), CHAVE_SECRETA).toString();
  fs.writeFileSync(caminho, textoCifrado);
}

function lerLicencaCriptografada(caminho) {
  const conteudo = fs.readFileSync(caminho, 'utf8');
  const bytes = CryptoJS.AES.decrypt(conteudo, CHAVE_SECRETA);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

// CORREÇÃO 1: Desativa a aceleração por hardware. 
app.disableHardwareAcceleration();

// ===================================================
// 🖥️ FUNÇÃO: CAPTURAR ID ÚNICO DO COMPUTADOR
// ===================================================
function obterIdComputador() {
  try {
    const comando = 'reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid';
    const resultado = execSync(comando, { encoding: 'utf8' });
    const matches = resultado.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    return matches ? matches[0].toUpperCase() : 'ID-DESCONHECIDO';
  } catch (erro) {
    console.error("Erro ao obter ID do hardware:", erro);
    return 'ID-ERRO';
  }
}

// ===================================================
// 🕒 SUB-SISTEMA DE CONTROLE DE LICENÇA (ONLINE + TRIAL)
// ===================================================
async function checarLicenca() {
  const pastaSegura = app.getPath('userData');
  const arquivoLicenca = path.join(pastaSegura, 'status_licenca.json');
  const hoje = new Date();

  // Se não existir, cria um novo (criptografado)
  if (!fs.existsSync(arquivoLicenca)) {
    const dadosIniciais = {
      dataInstalacao: hoje.toISOString(),
      status: 'trial',
      cns: ''
    };
    salvarLicencaCriptografada(arquivoLicenca, dadosIniciais);
    return { liberado: true, avisoTrial: true, diasRestantes: 3 }; 
  }

  // TENTA LER E DESCRIPTOGRAFAR
  let info;
  try {
    info = lerLicencaCriptografada(arquivoLicenca);
  } catch (erro) {
    console.error("Erro ao ler/descriptografar licença (Arquivo corrompido ou chave errada):", erro);
    return { liberado: false, motivo: 'geral' }; 
  }

  if (info.status === 'ativado' && info.cns) {
    try {
      const urlGitHub = "https://raw.githubusercontent.com/ancillasys/ancillasys/refs/heads/main/ativados.json"; 
      
      const resposta = await fetch(`${urlGitHub}?t=${Date.now()}`);
      if (!resposta.ok) {
        throw new Error("Não foi possível conectar ao servidor de licenças.");
      }
      
      const listaClientesAtivos = await resposta.json();
      const dadosCliente = listaClientesAtivos[info.cns];

      if (dadosCliente) {
        const idLocal = obterIdComputador();
        const idsAutorizados = dadosCliente.hardwareId || [];
        const listaIds = Array.isArray(idsAutorizados) ? idsAutorizados : [idsAutorizados];

        if (!listaIds.includes(idLocal)) {
          return { liberado: false, motivo: 'hardware' }; 
        }

        if (dadosCliente.plano === 'vitalicio') {
          return { liberado: true };
        }

        if (dadosCliente.plano === 'anual') {
          const dataValidade = new Date(dadosCliente.validoAte + "T23:59:59");
          if (hoje <= dataValidade) {
            return { liberado: true }; 
          } else {
            return { liberado: false, motivo: 'anual' }; 
          }
        }
      }
      return { liberado: false, motivo: 'invalido' };

    } catch (erro) {
      console.error("Erro ao checar online, usando contingência local:", erro);
      return { liberado: true }; 
    }
  }

  if (info.status === 'trial') {
    const dataInstalacao = new Date(info.dataInstalacao);
    const diferencaTempo = hoje - dataInstalacao;
    const diferencaDias = Math.floor(diferencaTempo / (1000 * 60 * 60 * 24));
    
    if (diferencaDias >= 3) {
      info.status = 'expirado';
      salvarLicencaCriptografada(arquivoLicenca, info); // Atualiza criptografado
      return { liberado: false, motivo: 'trial' };
    }

    const diasRestantes = 3 - diferencaDias;
    return { liberado: true, avisoTrial: true, diasRestantes: diasRestantes };
  }

  return { liberado: false, motivo: 'geral' };
}

async function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'icone.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, 
      devTools: false           
    }
  });

  mainWindow.setMenu(null); 

  const licenca = await checarLicenca();
  
  if (licenca.liberado) {
    mainWindow.loadFile('index.html'); 

    if (licenca.avisoTrial) {
      mainWindow.webContents.once('did-finish-load', () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Período de Avaliação',
          message: `Você está utilizando a versão de testes do sistema.\n\nRestam exatamente ${licenca.diasRestantes} dia(s) de uso gratuito.`,
          buttons: ['Continuar Testando']
        });
      });
    }

  } else {
    const motivo = licenca.motivo || 'geral';
    mainWindow.loadURL(`file://${path.join(__dirname, 'bloqueio.html')}?motivo=${motivo}`);
  }

  mainWindow.once('ready-to-show', () => {
    autoUpdater.checkForUpdatesAndNotify();
  });

  mainWindow.on('focus', () => {
    mainWindow.webContents.focus();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('obter-caminho-rede', async () => {
  const configPath = path.join(app.getPath('userData'), 'config_rede.json');

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.pastaRede && fs.existsSync(config.pastaRede)) {
        return config.pastaRede; 
      }
    } catch (e) {
      console.error("Erro ao ler configuração anterior:", e);
    }
  }

  const resultado = await dialog.showOpenDialog({
    title: "PRIMEIRA CONFIGURAÇÃO: Selecione a pasta do Servidor do Cartório",
    properties: ['openDirectory', 'createDirectory']
  });

  if (resultado.canceled) return null; 

  const novaPasta = resultado.filePaths[0];
  fs.writeFileSync(configPath, JSON.stringify({ pastaRede: novaPasta }));
  return novaPasta;
});

ipcMain.handle('obter-id-computador', async () => {
  return obterIdComputador();
});

ipcMain.handle('ativar-sistema-definitivo', async (event, cnsDigitado) => {
  const arquivoLicenca = path.join(app.getPath('userData'), 'status_licenca.json');
  try {
    if (!cnsDigitado) {
      return { sucesso: false, erro: "O campo CNS não pode estar vazio." };
    }

    const info = { 
      status: 'ativado', 
      cns: String(cnsDigitado).trim(), 
      dataAtivacao: new Date().toISOString() 
    };
    
    // Salva de forma criptografada
    salvarLicencaCriptografada(arquivoLicenca, info);
    return { sucesso: true };
  } catch (error) {
    return { sucesso: false, erro: error.message };
  }
});

// =================================================================
// 🖥️ RECEPTOR PARA CRIAR A JANELA DE PRÉVIA CUSTOMIZADA (v1.1.0)
// =================================================================
ipcMain.on('abrir-janela-previa', (event, htmlCompleto) => {
  // Salva o livro montado temporariamente na pasta segura do app
  const tempPath = path.join(app.getPath('userData'), 'temp_preview.html');
  fs.writeFileSync(tempPath, htmlCompleto, 'utf8');

  // Cria uma janela dedicada e elegante para a pré-visualização
  const previewWindow = new BrowserWindow({
    width: 1050,
    height: 850,
    title: 'Pré-visualização de Impressão — Cartório Control',
    icon: path.join(__dirname, 'icone.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  previewWindow.setMenu(null); // Remove menus padrões
  previewWindow.loadFile(tempPath); // Abre as folhas A4 na tela do sistema
});

// =================================================================
// 🖥️ RECEPTOR PARA CRIAR A JANELA DE PRÉVIA CUSTOMIZADA (v1.1.0)
// =================================================================
ipcMain.on('abrir-janela-previa', (event, htmlCompleto) => {
  // Salva o livro montado temporariamente na pasta segura do app
  const tempPath = path.join(app.getPath('userData'), 'temp_preview.html');
  fs.writeFileSync(tempPath, htmlCompleto, 'utf8');

  // Cria uma janela dedicada e elegante para a pré-visualização
  const previewWindow = new BrowserWindow({
    width: 1050,
    height: 850,
    title: 'Pré-visualização de Impressão — Cartório Control',
    icon: path.join(__dirname, 'icone.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  previewWindow.setMenu(null); // Remove menus padrões
  previewWindow.loadFile(tempPath); // Abre as folhas A4 na tela do sistema
});

// =================================================================
// 🖨️ RECEPTOR SEGURO PARA IMPRESSÃO SILENCIOSA DIRETA (v1.3.0)
// =================================================================
ipcMain.on('executar-impressao-silenciosa', (event) => {
  // Captura a janela exata que solicitou a impressão
  const janelaPrevia = BrowserWindow.fromWebContents(event.sender);
  
  if (janelaPrevia) {
    // Dispara a impressão direta. O motor respeitará as páginas ocultadas via CSS!
    janelaPrevia.webContents.print({
      silent: true,           // Direto para a impressora padrão do Windows
      printBackground: true   // Preserva as cores e estilos CSS no papel
    }, (sucesso, tipoErro) => {
      if (!sucesso) {
        console.error(`Falha ao imprimir silenciosamente: ${tipoErro}`);
      } else {
        console.log('Impressão enviada com sucesso para a fila do Windows!');
      }
    });
  }
});