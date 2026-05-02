import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, MessageCircle, User, ArrowLeft } from 'lucide-react';

export default function Conversas() {
  const [contatos, setContatos] = useState([]);
  const [loadingContatos, setLoadingContatos] = useState(true);
  const [busca, setBusca] = useState('');

  const [contatoAtivo, setContatoAtivo] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [loadingMensagens, setLoadingMensagens] = useState(false);
  const [paginacao, setPaginacao] = useState(null);

  useEffect(() => {
    carregarContatos();
  }, []);

  async function carregarContatos() {
    try {
      const { data } = await api.get('/admin/conversas/contatos');
      setContatos(data.data);
    } catch {
      // silencia — lista vazia
    } finally {
      setLoadingContatos(false);
    }
  }

  async function abrirConversa(contato) {
    setContatoAtivo(contato);
    setMensagens([]);
    setLoadingMensagens(true);
    try {
      const { data } = await api.get('/admin/conversas', {
        params: { telefone: contato.telefone, limit: 200 },
      });
      setMensagens(data.data.conversas);
      setPaginacao(data.data.paginacao);
    } catch {
      // silencia
    } finally {
      setLoadingMensagens(false);
    }
  }

  const contatosFiltrados = contatos.filter((c) => {
    const termo = busca.replace(/\D/g, '') || busca.toLowerCase();
    return (
      c.telefone.includes(termo) ||
      (c.nome ?? '').toLowerCase().includes(busca.toLowerCase())
    );
  });

  return (
    <div className="flex h-[calc(100vh-8rem)] bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">

      {/* ── Painel esquerdo: lista de contatos ── */}
      {/* No mobile, fica oculto quando uma conversa está aberta (mostra o painel de mensagens em tela cheia) */}
      <div className={`w-full md:w-80 md:flex-shrink-0 border-r border-gray-100 flex-col ${
        contatoAtivo ? 'hidden md:flex' : 'flex'
      }`}>
        <div className="px-4 py-3 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900 mb-2">Conversas</h1>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingContatos ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : contatosFiltrados.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              {busca ? 'Nenhum contato encontrado.' : 'Nenhuma conversa ainda.'}
            </div>
          ) : (
            contatosFiltrados.map((contato) => {
              const ativo = contatoAtivo?.telefone === contato.telefone;
              return (
                <button
                  key={contato.telefone}
                  onClick={() => abrirConversa(contato)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    ativo ? 'bg-emerald-50 border-l-2 border-l-emerald-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <User size={16} className="text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {contato.nome ?? contato.telefone}
                        </p>
                        <p className="text-xs text-gray-400 flex-shrink-0">
                          {formatDistanceToNow(new Date(contato.ultima_data), {
                            locale: ptBR,
                            addSuffix: false,
                          })}
                        </p>
                      </div>
                      {contato.nome && (
                        <p className="text-xs text-gray-400 truncate">{contato.telefone}</p>
                      )}
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {contato.ultima_mensagem}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Painel direito: mensagens ── */}
      {/* No mobile, oculto quando nenhuma conversa está aberta */}
      <div className={`flex-1 flex-col min-w-0 ${contatoAtivo ? 'flex' : 'hidden md:flex'}`}>
        {!contatoAtivo ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageCircle size={40} className="mb-3 text-gray-300" />
            <p className="text-sm">Selecione um contato para ver a conversa</p>
          </div>
        ) : (
          <>
            {/* Header da conversa — botão voltar só aparece no mobile */}
            <div className="px-4 md:px-5 py-3 border-b border-gray-100 flex items-center gap-3">
              <button
                onClick={() => setContatoAtivo(null)}
                className="md:hidden text-gray-500 hover:text-gray-800 -ml-1 flex-shrink-0"
                title="Voltar para lista de contatos"
                aria-label="Voltar"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <User size={15} className="text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {contatoAtivo.nome ?? contatoAtivo.telefone}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {contatoAtivo.nome ? contatoAtivo.telefone + ' · ' : ''}
                  {contatoAtivo.total} mensagem(ns)
                </p>
              </div>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingMensagens ? (
                <div className="flex justify-center items-center h-full">
                  <div className="animate-spin w-7 h-7 border-4 border-emerald-500 border-t-transparent rounded-full" />
                </div>
              ) : (
                <>
                  {paginacao?.total > mensagens.length && (
                    <p className="text-center text-xs text-gray-400 mb-2">
                      Exibindo as {mensagens.length} mensagens mais recentes de {paginacao.total} — role para cima para ver o histórico completo
                    </p>
                  )}
                  {mensagens.map((msg) => {
                    const isBot = msg.direcao === 'saida';
                    return (
                      <div key={msg.id} className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[72%] px-3.5 py-2 rounded-2xl text-sm ${
                          isBot
                            ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                            : 'bg-emerald-500 text-white rounded-tr-sm'
                        }`}>
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.mensagem}</p>
                          <p className={`text-xs mt-1 ${isBot ? 'text-gray-400' : 'text-emerald-100'}`}>
                            {format(new Date(msg.createdAt), "HH:mm · dd/MM/yy", { locale: ptBR })}
                            {isBot && ' · Bot'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
