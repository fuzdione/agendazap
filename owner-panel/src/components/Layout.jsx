import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Building2, Smartphone, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const navItems = [
  { to: '/',          label: 'Dashboard',           icon: LayoutDashboard, end: true },
  { to: '/clinicas',  label: 'Clínicas',             icon: Building2 },
  { to: '/instancias', label: 'Instâncias WhatsApp', icon: Smartphone },
];

export default function Layout() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const navLinkClass = ({ isActive }) =>
    [
      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
      isActive
        ? 'bg-slate-600 text-white'
        : 'text-slate-300 hover:bg-slate-700 hover:text-white',
    ].join(' ');

  const sidebar = (
    <aside className="flex flex-col h-full bg-slate-900 w-64">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-slate-700">
        <p className="text-white font-bold text-lg leading-tight">AgendaZap</p>
        <p className="text-slate-400 text-xs mt-0.5">Painel do Proprietário</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={navLinkClass} onClick={() => setSidebarOpen(false)}>
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-700">
        <p className="text-slate-400 text-xs mb-3 truncate">{usuario?.email}</p>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar desktop */}
      <div className="hidden md:flex flex-shrink-0">{sidebar}</div>

      {/* Sidebar mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-50">{sidebar}</div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header mobile */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b shadow-sm">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600">
            <Menu size={22} />
          </button>
          <span className="font-semibold text-slate-800">AgendaZap — Proprietário</span>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
