import { describe, it, expect } from 'vitest';
import {
  formatToWhatsApp,
  formatFromWhatsApp,
  extractDDD,
  isValidBRPhone,
} from '../phoneHelper.js';

describe('formatToWhatsApp', () => {
  it('adiciona código do país e sufixo quando recebe número com DDD', () => {
    expect(formatToWhatsApp('61999990001')).toBe('5561999990001@s.whatsapp.net');
  });

  it('é idempotente — não duplica código do país', () => {
    expect(formatToWhatsApp('5561999990001')).toBe('5561999990001@s.whatsapp.net');
  });

  it('remove o + do formato internacional', () => {
    expect(formatToWhatsApp('+5561999990001')).toBe('5561999990001@s.whatsapp.net');
  });

  it('funciona com número fixo (8 dígitos)', () => {
    expect(formatToWhatsApp('6133334444')).toBe('556133334444@s.whatsapp.net');
  });

  it('remove caracteres não numéricos (parênteses, hífen, espaço)', () => {
    expect(formatToWhatsApp('(61) 99999-0001')).toBe('5561999990001@s.whatsapp.net');
  });
});

describe('formatFromWhatsApp', () => {
  it('remove sufixo @s.whatsapp.net', () => {
    expect(formatFromWhatsApp('5561999990001@s.whatsapp.net')).toBe('5561999990001');
  });

  it('remove sufixo @g.us de grupos', () => {
    expect(formatFromWhatsApp('556181293323-1354631651@g.us')).toBe('556181293323-1354631651');
  });

  it('remove sufixo @lid (novo protocolo WhatsApp)', () => {
    expect(formatFromWhatsApp('276063401816202@lid')).toBe('276063401816202');
  });

  it('retorna string sem alteração se não tiver sufixo conhecido', () => {
    expect(formatFromWhatsApp('5561999990001')).toBe('5561999990001');
  });
});

describe('extractDDD', () => {
  it('extrai DDD de número com código do país', () => {
    expect(extractDDD('5561999990001')).toBe('61');
  });

  it('extrai DDD de número sem código do país', () => {
    expect(extractDDD('61999990001')).toBe('61');
  });

  it('extrai DDD 11 (São Paulo)', () => {
    expect(extractDDD('5511999990001')).toBe('11');
  });
});

describe('isValidBRPhone', () => {
  it('valida celular com 9 dígitos + DDD', () => {
    expect(isValidBRPhone('61999990001')).toBe(true);
  });

  it('valida celular com código do país', () => {
    expect(isValidBRPhone('5561999990001')).toBe(true);
  });

  it('valida número fixo com 8 dígitos + DDD', () => {
    expect(isValidBRPhone('6133334444')).toBe(true);
  });

  it('rejeita número curto demais', () => {
    expect(isValidBRPhone('6199999')).toBe(false);
  });

  it('rejeita número longo demais', () => {
    expect(isValidBRPhone('556199999000112')).toBe(false);
  });

  it('rejeita DDD inválido (abaixo de 11)', () => {
    expect(isValidBRPhone('01999990001')).toBe(false);
  });

  it('rejeita string vazia', () => {
    expect(isValidBRPhone('')).toBe(false);
  });
});
