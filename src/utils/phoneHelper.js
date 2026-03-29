/**
 * Helpers para formatação e validação de números de telefone brasileiros.
 * A Evolution API usa o formato E.164 + sufixo @s.whatsapp.net internamente.
 */

/**
 * Converte número brasileiro para o formato esperado pela Evolution API.
 * Ex: "61999990001" → "5561999990001@s.whatsapp.net"
 * Ex: "5561999990001" → "5561999990001@s.whatsapp.net" (idempotente)
 */
export function formatToWhatsApp(phone) {
  const digits = phone.replace(/\D/g, '');

  // Já está no formato completo com código do país
  if (digits.startsWith('55') && digits.length >= 12) {
    return `${digits}@s.whatsapp.net`;
  }

  // Adiciona o código do país Brasil
  return `55${digits}@s.whatsapp.net`;
}

/**
 * Extrai apenas os dígitos do JID da Evolution API.
 * Ex: "5561999990001@s.whatsapp.net" → "5561999990001"
 */
export function formatFromWhatsApp(jid) {
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}

/**
 * Extrai o DDD de um número com código de país.
 * Ex: "5561999990001" → "61"
 */
export function extractDDD(phone) {
  const digits = phone.replace(/\D/g, '');
  // Remove código do país (55) e pega os 2 dígitos seguintes
  const withoutCountry = digits.startsWith('55') ? digits.slice(2) : digits;
  return withoutCountry.slice(0, 2);
}

/**
 * Valida se o número é um telefone brasileiro válido.
 * Aceita formatos: com ou sem código do país, com ou sem DDD.
 * Mínimo esperado: DDD (2) + número (8 ou 9 dígitos) = 10 ou 11 dígitos.
 */
export function isValidBRPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  const withoutCountry = digits.startsWith('55') ? digits.slice(2) : digits;

  // Deve ter 10 (fixo) ou 11 (celular) dígitos após remover o código do país
  if (withoutCountry.length < 10 || withoutCountry.length > 11) return false;

  const ddd = parseInt(withoutCountry.slice(0, 2), 10);
  // DDDs válidos no Brasil: 11–99 (não existem DDDs abaixo de 11)
  if (ddd < 11 || ddd > 99) return false;

  return true;
}
