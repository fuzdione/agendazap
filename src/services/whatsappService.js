import { env } from '../config/env.js';
import { formatToWhatsApp } from '../utils/phoneHelper.js';

const BASE_URL = env.EVOLUTION_API_URL;
const API_KEY = env.EVOLUTION_API_KEY;

/**
 * Headers padrão para todas as requisições à Evolution API.
 */
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': API_KEY,
  };
}

/**
 * Wrapper de fetch que lança erro com mensagem legível em caso de falha HTTP.
 */
async function request(method, path, body = null) {
  const options = {
    method,
    headers: getHeaders(),
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Evolution API ${method} ${path} → ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Cria uma instância do WhatsApp na Evolution API e configura o webhook
 * para receber mensagens no endpoint do nosso servidor.
 *
 * @param {string} instanceName - Identificador único da instância (usamos o telefone da clínica)
 * @param {string} webhookUrl - URL que a Evolution vai chamar ao receber mensagens
 */
export async function createInstance(instanceName, webhookUrl) {
  console.log(`📱 Criando instância WhatsApp: ${instanceName}`);

  const data = await request('POST', '/instance/create', {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: {
      url: webhookUrl,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT'],
    },
  });

  console.log(`✅ Instância criada: ${instanceName}`);
  return data;
}

/**
 * Retorna o QR code para conectar o WhatsApp ao celular da clínica.
 * O QR code é retornado como string base64.
 *
 * @param {string} instanceName
 */
export async function getQRCode(instanceName) {
  console.log(`🔲 Buscando QR code da instância: ${instanceName}`);
  return request('GET', `/instance/connect/${instanceName}`);
}

/**
 * Envia uma mensagem de texto via Evolution API com retry automático (máx 2 tentativas).
 *
 * @param {string} instanceName - Instância da clínica
 * @param {string} phone - Número do destinatário (qualquer formato brasileiro)
 * @param {string} text - Texto da mensagem
 */
export async function sendTextMessage(instanceName, phoneOrJid, text) {
  // Aceita número de telefone ou JID completo (ex: @s.whatsapp.net, @lid)
  const jid = phoneOrJid.includes('@') ? phoneOrJid : formatToWhatsApp(phoneOrJid);
  console.log(`📤 Enviando mensagem para ${jid} via instância ${instanceName}`);

  let lastError;

  // Tenta até 2 vezes antes de desistir
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await request('POST', `/message/sendText/${instanceName}`, {
        number: jid,
        text,
        options: { delay: 1200 },
      });

      console.log(`✅ Mensagem enviada para ${jid} (tentativa ${attempt})`);
      return data;
    } catch (err) {
      lastError = err;
      console.error(`❌ Erro ao enviar mensagem (tentativa ${attempt}): ${err.message}`);

      if (attempt < 2) {
        // Aguarda 1s antes de tentar novamente
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError;
}

/**
 * Retorna o estado de conexão de uma instância.
 * Possíveis estados: open (conectado), close (desconectado), connecting (aguardando QR).
 *
 * @param {string} instanceName
 */
export async function getInstanceStatus(instanceName) {
  return request('GET', `/instance/connectionState/${instanceName}`);
}

/**
 * Desconecta o WhatsApp de uma instância (logout), mantendo a instância criada.
 * Após o logout será necessário escanear o QR code novamente para reconectar.
 *
 * @param {string} instanceName
 */
export async function logoutInstance(instanceName) {
  console.log(`🔌 Desconectando instância: ${instanceName}`);
  return request('DELETE', `/instance/logout/${instanceName}`);
}

/**
 * Remove permanentemente uma instância da Evolution API.
 *
 * @param {string} instanceName
 */
export async function deleteInstance(instanceName) {
  console.log(`🗑️ Deletando instância: ${instanceName}`);
  return request('DELETE', `/instance/delete/${instanceName}`);
}
