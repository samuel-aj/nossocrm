import React, { useRef, useState, useEffect } from 'react';
import { Bell, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useSystemNotifications, SystemNotification } from '@/hooks/useSystemNotifications';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePersonalNotifications } from './usePersonalNotifications';
import { NotificationPreferences } from './NotificationPreferences';

const getTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'agora mesmo';
    if (diffInSeconds < 3600) return `há ${Math.floor(diffInSeconds / 60)} min`;
    if (diffInSeconds < 86400) return `há ${Math.floor(diffInSeconds / 3600)} h`;
    return `há ${Math.floor(diffInSeconds / 86400)} dias`;
};

/**
 * Componente React `NotificationPopover`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const NotificationPopover = () => {
    const { notifications, count, hasHighSeverity, markAsRead, markAllAsRead } = useSystemNotifications();
    const personal = usePersonalNotifications();
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleNotificationClick = (id: string) => {
        markAsRead(id);
        setIsOpen(false);
    };

    const getIcon = (type: SystemNotification['type']) => {
        switch (type) {
            case 'SYSTEM_ALERT':
                return <AlertTriangle className="w-5 h-5 text-red-500" />;
            case 'SYSTEM_WARNING':
                return <AlertTriangle className="w-5 h-5 text-orange-500" />;
            case 'SYSTEM_SUCCESS':
                return <CheckCircle2 className="w-5 h-5 text-green-500" />;
            case 'SYSTEM_INFO':
            default:
                return <Bell className="w-5 h-5 text-blue-500" />;
        }
    };

    const getBgColor = (type: SystemNotification['type']) => {
        switch (type) {
            case 'SYSTEM_ALERT':
                return 'bg-red-50 dark:bg-red-900/20';
            case 'SYSTEM_WARNING':
                return 'bg-orange-50 dark:bg-orange-900/20';
            case 'SYSTEM_SUCCESS':
                return 'bg-green-50 dark:bg-green-900/20';
            case 'SYSTEM_INFO':
            default:
                return 'bg-blue-50 dark:bg-blue-900/20';
        }
    };

    return (
        <div className="relative" ref={popoverRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-label={`Notificações: ${count + personal.notices.length} novas`}
                className="p-2 max-md:p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-full relative transition-colors focus-visible-ring"
            >
                <Bell size={20} aria-hidden="true" />
                {(count > 0 || personal.notices.length > 0) && (
                    <span
                        className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-dark-card ${hasHighSeverity ? 'bg-red-500' : 'bg-blue-500'
                            }`}
                        aria-hidden="true"
                    />
                )}
            </button>

            {isOpen && (
                <div
                    className="absolute right-0 mt-2 w-80 sm:w-96 max-md:fixed max-md:inset-x-3 max-md:top-16 max-md:mt-0 max-md:w-auto bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200"
                    role="dialog"
                    aria-label="Central de Notificações"
                >
                    <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-white/5">
                        <h3 className="font-semibold text-slate-900 dark:text-white">Notificações</h3>
                        <div className="flex items-center gap-2">
                            {count > 0 && (
                                <button
                                    onClick={() => markAllAsRead()}
                                    className="text-xs text-slate-500 hover:text-primary-600 transition-colors"
                                >
                                    Marcar todas como lidas
                                </button>
                            )}
                            {count > 0 && (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                                    {count} nova{count !== 1 && 's'}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5">
                        <button className="text-sm font-medium text-primary-600 dark:text-primary-400 disabled:opacity-50" disabled={!personal.settings} onClick={()=>{setIsOpen(false);setPreferencesOpen(true);}}>Preferências de notificações</button>
                        {personal.loading && <p className="text-xs text-slate-500">Carregando preferências…</p>}
                        {personal.error && <p role="status" className="text-xs text-amber-600 mt-1">{personal.error}</p>}
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto">
                        {personal.notices.length>0 && <div>
                            <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-500"><span>Mensagens e leads recentes</span><button onClick={personal.clear}>Limpar avisos</button></div>
                            {personal.notices.map(n=><Link key={n.id} href={n.href} onClick={()=>setIsOpen(false)} className="block p-4 border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5"><p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</p><p className="text-sm text-slate-500">{n.message}</p><p className="text-xs text-slate-400 mt-1">{getTimeAgo(new Date(n.createdAt))}</p></Link>)}
                        </div>}
                        {notifications.length === 0 && personal.notices.length === 0 ? (
                            <div className="p-8 text-center flex flex-col items-center text-slate-500 dark:text-slate-400">
                                <div className="w-12 h-12 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-3">
                                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                                </div>
                                <p className="font-medium text-slate-900 dark:text-white">Tudo limpo!</p>
                                <p className="text-sm">Você não tem notificações.</p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-100 dark:divide-white/5">
                                {notifications.map((notification) => (
                                    <li key={notification.id} className={notification.readAt ? 'opacity-60 bg-slate-50/30 dark:bg-white/5' : ''}>
                                        <Link
                                            href={notification.actionLink || '#'}
                                            onClick={() => handleNotificationClick(notification.id)}
                                            className="flex gap-4 p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group"
                                        >
                                            <div className={`mt-1 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${getBgColor(notification.type)}`}>
                                                {getIcon(notification.type)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <p className={`text-sm font-medium group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors ${notification.readAt ? 'text-slate-600 dark:text-slate-300' : 'text-slate-900 dark:text-white'}`}>
                                                        {notification.title}
                                                    </p>
                                                    {!notification.readAt && (
                                                        <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                                                    )}
                                                </div>
                                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                                                    {notification.message}
                                                </p>
                                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 flex items-center gap-1">
                                                    <Clock size={12} />
                                                    {getTimeAgo(notification.timestamp)}
                                                </p>
                                            </div>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="p-3 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 text-center">
                        <Link
                            href="/dashboard"
                            onClick={() => setIsOpen(false)}
                            className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        >
                            Ver Dashboard Completo
                        </Link>
                    </div>
                </div>
            )}
            {preferencesOpen && personal.settings && createPortal(<NotificationPreferences settings={personal.settings} onClose={()=>setPreferencesOpen(false)} onSave={personal.save} onTest={personal.test}/>, document.body)}
            {personal.toast && createPortal(<div role="status" className="fixed bottom-6 right-6 z-[11000] max-w-sm rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-slate-900 p-4 shadow-xl">
                <button aria-label="Fechar aviso" className="absolute right-2 top-1 px-2 text-slate-500" onClick={personal.dismiss}>×</button>
                <Link href={personal.toast.href} onClick={personal.dismiss} className="block pr-6"><p className="font-semibold text-slate-900 dark:text-white">{personal.toast.title}</p><p className="text-sm text-slate-500 mt-1">{personal.toast.message}</p></Link>
            </div>, document.body)}
        </div>
    );
};
