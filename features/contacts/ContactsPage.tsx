import React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { useContactsController } from './hooks/useContactsController';
import { useMyActionPermissions } from '@/lib/permissions/useMyActionPermissions';
import { contactsService } from '@/lib/supabase/contacts';
import { ContactsHeader } from './components/ContactsHeader';
import { ContactsFilters } from './components/ContactsFilters';
import { ContactsTabs } from './components/ContactsTabs';
import { ContactsStageTabs } from './components/ContactsStageTabs';
import { ContactsList } from './components/ContactsList';
import { ContactFormModal } from './components/ContactFormModal';
import { CompanyFormModal } from './components/CompanyFormModal';
import { SelectBoardModal } from './components/SelectBoardModal';
import { PaginationControls } from './components/PaginationControls';
import { ContactsImportExportModal } from './components/ContactsImportExportModal';
import ConfirmModal from '@/components/ConfirmModal';

/**
 * Componente React `ContactsPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ContactsPage: React.FC = () => {
    const controller = useContactsController();
    const minhasAcoes = useMyActionPermissions();

    // DEEP LINK: /contacts?contactId=... (vindo do Kanban, Inbox, Timeline)
    // abre o CONTATO direto, não só a aba. Roda uma vez, quando a lista chega;
    // depois limpa o parâmetro da URL pra fechar o modal não reabrir.
    const deepLinkFeito = React.useRef(false);
    const [highlightId, setHighlightId] = React.useState<string | null>(null);

    // Localiza o contato NA LISTA: calcula a página dele (ordenação padrão,
    // created_at desc), salta pra ela e acende o destaque por alguns segundos.
    const localizarNaLista = React.useCallback(
        async (contato: { id: string; createdAt: string }) => {
            try {
                const { data: antes } = await contactsService.getRankByCreatedAt(contato.createdAt);
                if (antes !== null) {
                    const pagina = Math.floor(antes / controller.pagination.pageSize);
                    controller.setPagination(prev =>
                        prev.pageIndex === pagina ? prev : { ...prev, pageIndex: pagina }
                    );
                }
            } catch {
                /* sem página calculada, ainda assim destaca se estiver visível */
            }
            setHighlightId(contato.id);
            setTimeout(() => setHighlightId(null), 6000);
        },
        [controller]
    );
    React.useEffect(() => {
        if (deepLinkFeito.current) return;
        const id = new URLSearchParams(window.location.search).get('contactId');
        if (!id) {
            deepLinkFeito.current = true;
            return;
        }
        const alvo = controller.contacts.find(c => c.id === id);
        if (alvo) {
            deepLinkFeito.current = true;
            controller.openEditModal(alvo);
            void localizarNaLista(alvo);
            window.history.replaceState({}, '', '/contacts');
            return;
        }
        // A lista é PAGINADA no servidor: contato fora da página carregada não
        // aparece nela nunca — busca direto pelo id e abre do mesmo jeito.
        if (controller.contacts.length === 0) return; // 1º load ainda em curso
        deepLinkFeito.current = true;
        void contactsService.getById(id).then(({ data }) => {
            if (data) {
                controller.openEditModal(data);
                void localizarNaLista(data);
            }
            window.history.replaceState({}, '', '/contacts');
        });
    }, [controller.contacts, controller.openEditModal]);
    const router = useRouter();
    const [isImportExportOpen, setIsImportExportOpen] = React.useState(false);

    const goToDeal = (dealId: string) => {
        controller.setDeleteWithDeals(null);
        router.push(`/boards?deal=${dealId}`);
    };

    return (
        <div className="space-y-6 p-8 max-md:p-4 max-w-[1600px] mx-auto">
            <ContactsHeader
                viewMode={controller.viewMode}
                search={controller.search}
                setSearch={controller.setSearch}
                statusFilter={controller.statusFilter}
                setStatusFilter={controller.setStatusFilter}
                isFilterOpen={controller.isFilterOpen}
                setIsFilterOpen={controller.setIsFilterOpen}
                openCreateModal={controller.openCreateModal}
                openImportExportModal={() => setIsImportExportOpen(true)}
            />

            <ContactsImportExportModal
                isOpen={isImportExportOpen}
                onClose={() => setIsImportExportOpen(false)}
                exportParams={{
                    search: controller.search?.trim() ? controller.search.trim() : undefined,
                    stage: controller.stageFilter,
                    status: controller.statusFilter,
                    dateStart: controller.dateRange?.start || undefined,
                    dateEnd: controller.dateRange?.end || undefined,
                    sortBy: controller.sortBy,
                    sortOrder: controller.sortOrder,
                }}
            />

            {controller.isFilterOpen && (
                <ContactsFilters
                    dateRange={controller.dateRange}
                    setDateRange={controller.setDateRange}
                />
            )}

            {/* Stage Tabs - Funil de Contatos */}
            <ContactsStageTabs
                activeStage={controller.stageFilter}
                onStageChange={controller.setStageFilter}
                counts={controller.stageCounts}
            />

            {/* Tabs de Pessoas/Empresas removidas — apenas Pessoas */}

            {/* Bulk Actions Bar */}
            {controller.selectedIds.size > 0 && (
                <div className="flex items-center justify-between bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                            {controller.selectedIds.size} {controller.viewMode === 'people' ? 'contato(s)' : 'empresa(s)'} selecionado(s)
                        </span>
                        <button
                            onClick={controller.clearSelection}
                            className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                        >
                            Limpar seleção
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Sem permissão de excluir contatos, o botão some (o banco recusa de qualquer jeito) */}
                        {minhasAcoes.contacts.delete && (
                            <button
                                onClick={() => controller.setBulkDeleteConfirm(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                <Trash2 size={14} />
                                Excluir selecionados
                            </button>
                        )}
                    </div>
                </div>
            )}

            <ContactsList
                highlightId={highlightId}
                viewMode={controller.viewMode}
                filteredContacts={controller.filteredContacts}
                filteredCompanies={controller.filteredCompanies}
                contacts={controller.contacts}
                selectedIds={controller.selectedIds}
                toggleSelect={controller.toggleSelect}
                toggleSelectAll={controller.toggleSelectAll}
                getCompanyName={controller.getCompanyName}
                updateContact={controller.updateContact}
                convertContactToDeal={controller.convertContactToDeal}
                openEditModal={controller.openEditModal}
                setDeleteId={controller.setDeleteId}
                openEditCompanyModal={controller.openEditCompanyModal}
                setDeleteCompanyId={controller.setDeleteCompanyId}
                sortBy={controller.sortBy}
                sortOrder={controller.sortOrder}
                onSort={controller.handleSort}
            />

            {/* T021: Pagination Controls */}
            {controller.viewMode === 'people' && controller.totalCount > 0 && (
                <PaginationControls
                    pagination={controller.pagination}
                    setPagination={controller.setPagination}
                    totalCount={controller.totalCount}
                    isFetching={controller.isFetching}
                    isPlaceholderData={controller.isPlaceholderData}
                />
            )}

            <ContactFormModal
                isOpen={controller.isModalOpen}
                onClose={() => controller.setIsModalOpen(false)}
                onSubmit={controller.handleSubmit}
                formData={controller.formData}
                setFormData={controller.setFormData}
                editingContact={controller.editingContact}
                createFakeContactsBatch={controller.createFakeContactsBatch}
                isSubmitting={controller.isSubmittingContact}
            />

            <CompanyFormModal
                isOpen={controller.isCompanyModalOpen}
                onClose={() => controller.setIsCompanyModalOpen(false)}
                onSubmit={controller.handleCompanySubmit}
                editingCompany={controller.editingCompany}
            />

            <SelectBoardModal
                isOpen={!!controller.createDealContactId}
                onClose={() => controller.setCreateDealContactId(null)}
                onSelect={controller.createDealForContact}
                boards={controller.boards}
                contactName={controller.contactForDeal?.name || ''}
            />

            <ConfirmModal
                isOpen={!!controller.deleteId}
                onClose={() => controller.setDeleteId(null)}
                onConfirm={controller.confirmDelete}
                title="Excluir Contato"
                message="Tem certeza que deseja excluir este contato? Esta ação não pode ser desfeita."
                confirmText="Excluir"
                variant="danger"
            />

            <ConfirmModal
                isOpen={!!controller.deleteCompanyId}
                onClose={() => controller.setDeleteCompanyId(null)}
                onConfirm={controller.confirmDeleteCompany}
                title="Excluir Empresa"
                message="Tem certeza que deseja excluir esta empresa? Esta ação não pode ser desfeita."
                confirmText="Excluir"
                variant="danger"
            />

            {/* Modal for contacts with deals */}
            <ConfirmModal
                isOpen={!!controller.deleteWithDeals}
                onClose={() => controller.setDeleteWithDeals(null)}
                onConfirm={controller.confirmDeleteWithDeals}
                title="Contato com Negócios"
                message={
                    <div className="space-y-3">
                        <p>Este contato possui {controller.deleteWithDeals?.dealCount || 0} negócio(s) vinculado(s):</p>
                        <ul className="text-left bg-slate-100 dark:bg-slate-800/50 rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
                            {controller.deleteWithDeals?.deals.map((deal) => (
                                <li key={deal.id} className="text-sm">
                                    <button
                                        onClick={() => goToDeal(deal.id)}
                                        className="text-primary-600 dark:text-primary-400 hover:underline font-medium text-left"
                                    >
                                        • {deal.title}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <p className="text-red-500 dark:text-red-400 font-medium">Ao excluir, todos os negócios também serão excluídos.</p>
                    </div>
                }
                confirmText="Excluir Tudo"
                variant="danger"
            />

            {/* Modal for bulk delete */}
            <ConfirmModal
                isOpen={controller.bulkDeleteConfirm}
                onClose={() => controller.setBulkDeleteConfirm(false)}
                onConfirm={controller.confirmBulkDelete}
                title={controller.viewMode === 'people' ? 'Excluir Contatos em Massa' : 'Excluir Empresas em Massa'}
                message={
                    <div className="space-y-2">
                        <p>
                            Tem certeza que deseja excluir <strong>{controller.selectedIds.size}</strong>{' '}
                            {controller.viewMode === 'people' ? 'contato(s)' : 'empresa(s)'}?
                        </p>
                        {controller.viewMode === 'people' ? (
                            <p className="text-red-500 dark:text-red-400 text-sm">
                                Todos os negócios vinculados também serão excluídos. Esta ação não pode ser desfeita.
                            </p>
                        ) : (
                            <p className="text-red-500 dark:text-red-400 text-sm">
                                Contatos/negócios vinculados serão desvinculados da empresa antes da exclusão. Esta ação não pode ser desfeita.
                            </p>
                        )}
                    </div>
                }
                confirmText={`Excluir ${controller.selectedIds.size} ${controller.viewMode === 'people' ? 'contato(s)' : 'empresa(s)'}`}
                variant="danger"
            />
        </div>
    );
};
