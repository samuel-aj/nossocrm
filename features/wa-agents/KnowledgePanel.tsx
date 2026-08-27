'use client';

/**
 * Aba "Conhecimento e mídias" do agente:
 * - Base de conhecimento: documentos (PDF, TXT, Markdown, DOCX) com status
 *   de processamento (consulta a cada 5 s enquanto houver "processando"),
 *   reprocessar e excluir.
 * - Mídias: imagem, vídeo, áudio ou PDF com nome e "quando enviar" editáveis
 *   na hora (PATCH), "Inserir no roteiro" ([[midia:nome]]) e excluir. Ao
 *   renomear, avisa o editor pai para trocar os marcadores já no roteiro.
 *
 * Upload: POST /api/wa-agents/uploads -> uploadToSignedUrl (bucket
 * wa-agent-files) -> POST documents|media. Precisa do agente salvo.
 */
import React, { useRef, useState } from 'react';
import {
  BookOpen,
  Paperclip,
  CloudUpload,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Trash2,
  RefreshCw,
  Loader2,
  CircleCheck,
  CircleAlert,
  Pencil,
  Save,
  Tags,
} from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import { AGENT_DOC_MIMES, type AgentDocumentRow, type AgentMediaRow } from '@/lib/wa-agents/types';
import { normalizeKeyword } from '@/lib/wa-agents/text';
import {
  uploadWaAgentFile,
  useAddWaAgentDocument,
  useAddWaAgentMedia,
  useDeleteWaAgentDocument,
  useDeleteWaAgentMedia,
  useReprocessWaAgentDocument,
  useUpdateWaAgentDocument,
  useUpdateWaAgentMedia,
  useWaAgentDocuments,
  useWaAgentMedia,
  type WaAgentMediaKind,
} from './useWaAgents';
import { mediaToken } from './PromptEditor';
import {
  BTN_ICON,
  BTN_PRIMARY,
  BTN_SMALL,
  Badge,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  Notice,
  Panel,
  SUBCARD_CLASS,
  Spinner,
  TEXTAREA_CLASS,
  TokenChip,
  errorMessage,
  formatBytes,
  formatDateTime,
  newId,
} from './ui';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const DOC_ACCEPT =
  '.pdf,.txt,.md,.markdown,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MEDIA_ACCEPT = 'image/*,video/*,audio/*,application/pdf,.pdf';

const DOC_EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const DOC_EXT_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'text/markdown': 'Markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

const MEDIA_KIND_LABELS: Record<WaAgentMediaKind, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
};

const MEDIA_ICONS: Record<WaAgentMediaKind, React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
};

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return (i > 0 ? name.slice(0, i) : name).trim();
}

/** MIME do documento pela extensão (os navegadores nem sempre informam .md e .docx direito). */
export function docMimeOf(file: File): string {
  return DOC_EXT_MIME[extensionOf(file.name)] ?? file.type ?? '';
}

export function isAcceptedDocMime(mime: string): boolean {
  return (AGENT_DOC_MIMES as readonly string[]).includes(mime);
}

/** Tipo da mídia pelo MIME (imagem, vídeo, áudio ou PDF); null quando não é aceito. */
export function mediaKindOf(file: File): WaAgentMediaKind | null {
  const t = file.type || '';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf' || extensionOf(file.name) === 'pdf') return 'document';
  return null;
}

/**
 * Limpa o nome de uma mídia: sem colchetes (quebrariam o marcador
 * [[midia:nome]], que termina no primeiro "]") e sem espaços repetidos.
 */
export function cleanMediaName(raw: string): string {
  return raw.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/** true quando `name` já é de outra mídia, comparando como o servidor (sem acento e caixa). */
export function mediaNameTaken(name: string, existing: string[]): boolean {
  const key = normalizeKeyword(name);
  return existing.some((n) => normalizeKeyword(n) === key);
}

/**
 * Nome único da mídia: o marcador [[midia:nome]] precisa apontar para uma só.
 * Compara como o servidor (sem acento e caixa) para não subir o arquivo e ter
 * o registro recusado depois, o que deixaria o arquivo órfão no bucket.
 */
export function uniqueMediaName(base: string, existing: string[]): string {
  const clean = cleanMediaName(base).slice(0, 80).trim() || 'midia';
  if (!mediaNameTaken(clean, existing)) return clean;
  const stem = clean.slice(0, 74).trim();
  let n = 2;
  while (mediaNameTaken(`${stem} (${n})`, existing)) n++;
  return `${stem} (${n})`;
}

type UploadItem = { id: string; name: string; size: number; status: 'uploading' | 'error'; error?: string };

/** Área de soltar arquivos + botão "Escolher arquivos" (input múltiplo escondido). */
function DropZone({
  accept,
  label,
  hint,
  onFiles,
  disabled,
}: {
  accept: string;
  label: string;
  hint: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types ?? []).includes('Files');
  return (
    <div
      onDragOver={(e) => {
        if (!hasFiles(e) || disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e) || disabled) return;
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) onFiles(files);
      }}
      className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
        over
          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/10'
          : 'border-slate-300 dark:border-white/10 bg-slate-50/60 dark:bg-slate-950/40'
      }`}
    >
      <CloudUpload size={24} className="mx-auto text-slate-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mt-1">{label}</p>
      <p className={HELP_CLASS}>{hint}</p>
      <button type="button" className={`${BTN_SMALL} mt-2`} onClick={() => inputRef.current?.click()} disabled={disabled}>
        <CloudUpload size={14} aria-hidden="true" />
        Escolher arquivos
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

function UploadList({ items, onDismiss }: { items: UploadItem[]; onDismiss: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="Envios em andamento">
      {items.map((u) => (
        <li
          key={u.id}
          className="flex items-center gap-2 text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2"
        >
          {u.status === 'uploading' ? (
            <Loader2 size={14} className="animate-spin text-purple-600 shrink-0" aria-hidden="true" />
          ) : (
            <CircleAlert size={14} className="text-red-600 shrink-0" aria-hidden="true" />
          )}
          <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">{u.name}</span>
          <span className="text-slate-400 shrink-0">{formatBytes(u.size)}</span>
          {u.status === 'uploading' ? (
            <span className="text-slate-500 shrink-0">Enviando...</span>
          ) : (
            <>
              <span className="text-red-600 dark:text-red-400 truncate max-w-[50%]" title={u.error}>
                {u.error}
              </span>
              <button type="button" className={BTN_SMALL} onClick={() => onDismiss(u.id)}>
                Ok
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function DocumentStatus({ doc }: { doc: AgentDocumentRow }) {
  if (doc.status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        Processando
      </span>
    );
  }
  if (doc.status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300">
        <CircleCheck size={12} aria-hidden="true" />
        Pronto
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300">
      <CircleAlert size={12} aria-hidden="true" />
      Erro
    </span>
  );
}

type DocumentMetaDraft = { title: string; description: string; tags: string };

function DocumentRow({
  doc,
  busy,
  onReprocess,
  onDelete,
  onSaveMeta,
}: {
  doc: AgentDocumentRow;
  busy: boolean;
  onReprocess: () => void;
  onDelete: () => void;
  onSaveMeta: (meta: { title: string | null; description: string | null; tags: string[] }) => Promise<unknown>;
}) {
  const chunks = doc.chunk_count ?? 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DocumentMetaDraft>({ title: '', description: '', tags: '' });
  const tags = (doc.tags ?? []).filter(Boolean);
  const openEdit = () => {
    setDraft({ title: doc.title ?? '', description: doc.description ?? '', tags: tags.join(', ') });
    setEditing(true);
  };
  const saveMeta = async () => {
    const parsedTags = Array.from(new Set(draft.tags.split(',').map((t) => t.trim()).filter(Boolean))).slice(0, 20);
    try {
      await onSaveMeta({ title: draft.title.trim() || null, description: draft.description.trim() || null, tags: parsedTags });
      setEditing(false);
    } catch {
      // o toast já avisou
    }
  };
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-3">
      <span className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
        <FileText size={16} aria-hidden="true" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white truncate" title={doc.name}>
          {(doc.title ?? '').trim() || doc.name}
          {(doc.title ?? '').trim() ? <span className="ml-1 text-xs font-normal text-slate-400">({doc.name})</span> : null}
        </p>
        {!editing && (doc.description ?? '').trim() ? (
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">{doc.description}</p>
        ) : null}
        {!editing && tags.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1 mt-1">
            <Tags size={12} className="text-slate-400" aria-hidden="true" />
            {tags.map((t) => (
              <Badge key={t} tone="slate">
                {t}
              </Badge>
            ))}
          </p>
        ) : null}
        {editing ? (
          <div className="mt-2 space-y-2 rounded-lg border border-purple-200 dark:border-purple-500/30 bg-purple-50/50 dark:bg-purple-900/10 p-2">
            <input
              className={INPUT_CLASS}
              value={draft.title}
              maxLength={160}
              placeholder="Título (como o agente vai chamar este documento)"
              aria-label="Título do documento"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <textarea
              className={TEXTAREA_CLASS}
              rows={2}
              value={draft.description}
              maxLength={1000}
              placeholder="Descrição: o que este documento cobre (ex.: tabela de honorários 2026; perguntas frequentes sobre BPC)"
              aria-label="Descrição do documento"
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <input
              className={INPUT_CLASS}
              value={draft.tags}
              placeholder="Etiquetas separadas por vírgula (ex.: honorários, prazos)"
              aria-label="Etiquetas do documento"
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            />
            <div className="flex items-center justify-between gap-2">
              <p className={HELP_CLASS}>Título, descrição e etiquetas entram em cada trecho vetorizado: ao salvar, o documento é reprocessado.</p>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" className={BTN_SMALL} onClick={() => setEditing(false)} disabled={busy}>
                  Cancelar
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={() => void saveMeta()} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} Salvar
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          <DocumentStatus doc={doc} />
          <Badge tone="slate">{DOC_EXT_LABEL[doc.mime ?? ''] ?? doc.mime ?? 'arquivo'}</Badge>
          <span>{formatBytes(doc.size_bytes)}</span>
          {doc.status === 'ready' ? <span>{chunks === 1 ? '1 trecho' : `${chunks} trechos`}</span> : null}
          <span>{formatDateTime(doc.created_at)}</span>
        </p>
        {doc.status === 'error' && doc.error ? (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 break-words">{doc.error}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          className={BTN_ICON}
          onClick={editing ? () => setEditing(false) : openEdit}
          disabled={busy}
          aria-label={`Editar título e descrição de ${doc.name}`}
          title="Título, descrição e etiquetas (metadados para a busca)"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={BTN_ICON}
          onClick={onReprocess}
          disabled={busy || doc.status === 'processing'}
          aria-label={`Reprocessar ${doc.name}`}
          title="Extrair e indexar de novo"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400`}
          onClick={onDelete}
          disabled={busy}
          aria-label={`Excluir ${doc.name}`}
          title="Excluir"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function MediaCard({
  media,
  otherNames,
  busy,
  onInsert,
  onSave,
  onRenamed,
  onDelete,
  onInvalidName,
}: {
  media: AgentMediaRow;
  /** Nomes das outras mídias do agente (o nome precisa ser único) */
  otherNames: string[];
  busy: boolean;
  onInsert: (name: string) => void;
  onSave: (patch: { name?: string; description?: string }) => Promise<unknown>;
  /** Chamado depois de renomear no servidor (o editor pai atualiza os marcadores do roteiro) */
  onRenamed?: (oldName: string, newName: string) => void;
  onDelete: () => void;
  /** Nome recusado antes do PATCH (repetido) */
  onInvalidName: (message: string) => void;
}) {
  const [name, setName] = useState(media.name);
  const [description, setDescription] = useState(media.description ?? '');
  const Icon = MEDIA_ICONS[media.kind] ?? FileText;
  const idPrefix = `media-${media.id}`;

  const commit = () => {
    const patch: { name?: string; description?: string } = {};
    const nextName = cleanMediaName(name);
    if (!nextName) {
      setName(media.name);
    } else if (nextName !== media.name) {
      // Mesma regra do servidor (sem acento e caixa), para avisar antes do PATCH.
      if (mediaNameTaken(nextName, otherNames)) {
        onInvalidName('Já existe uma mídia com este nome neste agente');
        setName(media.name);
      } else {
        patch.name = nextName;
        if (nextName !== name) setName(nextName);
      }
    }
    if (description.trim() !== (media.description ?? '').trim()) patch.description = description.trim();
    if (Object.keys(patch).length === 0) return;
    const oldName = media.name;
    onSave(patch)
      .then(() => {
        if (patch.name) onRenamed?.(oldName, patch.name);
      })
      .catch(() => {
        setName(media.name);
        setDescription(media.description ?? '');
      });
  };

  return (
    <div className={SUBCARD_CLASS}>
      <div className="flex items-start gap-3">
        <span className="w-12 h-12 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
          <Icon size={22} aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0 space-y-1.5">
          <input
            id={`${idPrefix}-name`}
            className={`${INPUT_CLASS} font-medium`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            maxLength={80}
            aria-label="Nome da mídia"
            placeholder="Nome da mídia"
          />
          <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Badge tone="green">{MEDIA_KIND_LABELS[media.kind] ?? media.kind}</Badge>
            <span>{formatBytes(media.size_bytes)}</span>
            <span className="truncate">{media.mime}</span>
          </p>
        </div>
        <button
          type="button"
          className={`${BTN_ICON} hover:text-red-600 dark:hover:text-red-400 shrink-0`}
          onClick={onDelete}
          disabled={busy}
          aria-label={`Excluir mídia ${media.name}`}
          title="Excluir"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      <Field
        label="Quando enviar"
        htmlFor={`${idPrefix}-description`}
        help="O agente usa esta descrição para decidir o momento de enviar. Salva ao sair do campo."
      >
        <textarea
          id={`${idPrefix}-description`}
          className={TEXTAREA_CLASS}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commit}
          maxLength={500}
          placeholder="Ex.: quando o cliente pedir a tabela de preços"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN_SMALL}
          onClick={() => onInsert(media.name)}
          title="Coloca o marcador desta mídia no cursor da aba Roteiro"
        >
          <FileText size={14} aria-hidden="true" />
          Inserir no roteiro
        </button>
        <TokenChip
          token={mediaToken(media.name)}
          tone="green"
          draggable={false}
          title={`Marcador desta mídia no roteiro: ${mediaToken(media.name)}. Clique para inserir no cursor; para arrastar, use a paleta da aba Roteiro.`}
          onInsert={() => onInsert(media.name)}
        />
        {busy ? (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            Salvando...
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Componente React `KnowledgePanel`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const KnowledgePanel: React.FC<{
  /** Agente salvo; null enquanto o agente novo não foi salvo (uploads bloqueados) */
  agentId: string | null;
  /** Insere `[[midia:nome]]` no cursor do roteiro (o editor pai troca de aba) */
  onInsertMedia: (name: string) => void;
  /** Mídia renomeada no servidor: o editor pai troca os marcadores [[midia:nome]] do roteiro */
  onRenameMedia?: (oldName: string, newName: string) => void;
  /** Salva o agente (para liberar os uploads de um agente novo) */
  onRequestSave: () => void;
  saving: boolean;
}> = ({ agentId, onInsertMedia, onRenameMedia, onRequestSave, saving }) => {
  const { showToast } = useToast();
  const docsQ = useWaAgentDocuments(agentId);
  const mediaQ = useWaAgentMedia(agentId);
  const addDoc = useAddWaAgentDocument(agentId);
  const delDoc = useDeleteWaAgentDocument(agentId);
  const reprocess = useReprocessWaAgentDocument(agentId);
  const updateDoc = useUpdateWaAgentDocument(agentId);
  const addMedia = useAddWaAgentMedia(agentId);
  const updateMedia = useUpdateWaAgentMedia(agentId);
  const delMedia = useDeleteWaAgentMedia(agentId);

  const [docUploads, setDocUploads] = useState<UploadItem[]>([]);
  const [mediaUploads, setMediaUploads] = useState<UploadItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'doc' | 'media'; id: string; name: string } | null>(null);

  const failUpload = (setter: React.Dispatch<React.SetStateAction<UploadItem[]>>, id: string, err: unknown) =>
    setter((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'error', error: errorMessage(err, 'Falha no envio') } : u)));
  const doneUpload = (setter: React.Dispatch<React.SetStateAction<UploadItem[]>>, id: string) =>
    setter((prev) => prev.filter((u) => u.id !== id));

  const uploadDocs = async (files: File[]) => {
    if (!agentId) return;
    let ok = 0;
    await Promise.all(
      files.map(async (file) => {
        const id = newId();
        setDocUploads((prev) => [...prev, { id, name: file.name, size: file.size, status: 'uploading' }]);
        try {
          const mime = docMimeOf(file);
          if (!isAcceptedDocMime(mime)) throw new Error('Tipo não aceito: envie PDF, TXT, Markdown ou DOCX');
          if (file.size > MAX_FILE_BYTES) throw new Error('Arquivo maior que 50 MB');
          const { path } = await uploadWaAgentFile({ agentId, file, kind: 'doc', mime });
          await addDoc.mutateAsync({ name: file.name.slice(0, 160), storage_path: path, mime, size_bytes: file.size });
          doneUpload(setDocUploads, id);
          ok++;
        } catch (err) {
          failUpload(setDocUploads, id, err);
        }
      })
    );
    if (ok > 0) showToast(ok === 1 ? 'Documento enviado. Processando...' : `${ok} documentos enviados. Processando...`, 'success');
  };

  const uploadMedia = async (files: File[]) => {
    if (!agentId) return;
    const taken = (mediaQ.data ?? []).map((m) => m.name);
    let ok = 0;
    await Promise.all(
      files.map(async (file) => {
        const id = newId();
        setMediaUploads((prev) => [...prev, { id, name: file.name, size: file.size, status: 'uploading' }]);
        try {
          const kind = mediaKindOf(file);
          if (!kind) throw new Error('Tipo não aceito: envie imagem, vídeo, áudio ou PDF');
          if (file.size > MAX_FILE_BYTES) throw new Error('Arquivo maior que 50 MB');
          const name = uniqueMediaName(baseName(file.name), taken);
          taken.push(name);
          const mime = file.type || (kind === 'document' ? 'application/pdf' : 'application/octet-stream');
          const { path } = await uploadWaAgentFile({ agentId, file, kind: 'media', mime });
          await addMedia.mutateAsync({ name, description: '', kind, storage_path: path, mime, size_bytes: file.size });
          doneUpload(setMediaUploads, id);
          ok++;
        } catch (err) {
          failUpload(setMediaUploads, id, err);
        }
      })
    );
    if (ok > 0) showToast(ok === 1 ? 'Mídia enviada. Descreva quando enviá-la.' : `${ok} mídias enviadas. Descreva quando enviá-las.`, 'success');
  };

  const runBusy = async (id: string, fn: () => Promise<unknown>, okMessage: string, failMessage: string) => {
    setBusyId(id);
    try {
      await fn();
      if (okMessage) showToast(okMessage, 'success');
    } catch (err) {
      showToast(errorMessage(err, failMessage), 'error');
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = () => {
    if (!confirm) return;
    const { kind, id } = confirm;
    setConfirm(null);
    void runBusy(
      id,
      () => (kind === 'doc' ? delDoc.mutateAsync(id) : delMedia.mutateAsync(id)),
      kind === 'doc' ? 'Documento excluído' : 'Mídia excluída',
      'Falha ao excluir'
    ).catch(() => undefined);
  };

  if (!agentId) {
    return (
      <Panel
        title="Conhecimento e mídias"
        icon={<BookOpen size={16} />}
        description="Documentos que o agente consulta e mídias que ele pode enviar na conversa."
      >
        <Notice tone="amber">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Salve o agente antes de enviar documentos e mídias. Depois de salvar, você continua aqui no editor.</span>
            <button type="button" className={BTN_PRIMARY} onClick={onRequestSave} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              Salvar agora
            </button>
          </div>
        </Notice>
      </Panel>
    );
  }

  const docs = docsQ.data ?? [];
  const media = mediaQ.data ?? [];

  return (
    <div className="space-y-4">
      <Panel
        title="Base de conhecimento"
        icon={<BookOpen size={16} />}
        description="Documentos que o agente consulta para responder (PDF, TXT, Markdown ou DOCX, até 50 MB cada). O CRM extrai o texto, divide em trechos e usa os mais relevantes em cada resposta."
      >
        <DropZone
          accept={DOC_ACCEPT}
          label="Arraste documentos aqui"
          hint="PDF, TXT, Markdown ou DOCX. Pode enviar vários de uma vez."
          onFiles={(files) => void uploadDocs(files)}
        />
        <UploadList items={docUploads} onDismiss={(id) => doneUpload(setDocUploads, id)} />

        {docsQ.isLoading ? (
          <Spinner label="Carregando documentos..." />
        ) : docsQ.error ? (
          <Notice tone="red">{errorMessage(docsQ.error, 'Falha ao carregar os documentos')}</Notice>
        ) : docs.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nenhum documento. Sem base de conhecimento, o agente responde só com o roteiro.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Documentos">
            {docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                busy={busyId === doc.id}
                onReprocess={() =>
                  void runBusy(doc.id, () => reprocess.mutateAsync(doc.id), 'Reprocessando o documento...', 'Falha ao reprocessar').catch(
                    () => undefined
                  )
                }
                onDelete={() => setConfirm({ kind: 'doc', id: doc.id, name: doc.name })}
                onSaveMeta={(meta) =>
                  runBusy(
                    doc.id,
                    async () => {
                      await updateDoc.mutateAsync({ docId: doc.id, meta });
                      // revetoriza com o cabeçalho novo (título/descrição/etiquetas)
                      if (doc.status === 'ready' || doc.status === 'error') await reprocess.mutateAsync(doc.id);
                    },
                    'Metadados salvos. Reprocessando o documento...',
                    'Falha ao salvar os metadados'
                  )
                }
              />
            ))}
          </ul>
        )}
        {docs.some((d) => d.status === 'processing') ? (
          <p className={HELP_CLASS} role="status">
            Processando: a lista atualiza sozinha a cada 5 segundos.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Mídias"
        icon={<Paperclip size={16} />}
        description="Imagens, vídeos, áudios e PDFs que o agente pode enviar na conversa. Descreva quando enviar cada um ou marque o momento no roteiro com Inserir no roteiro."
      >
        <DropZone
          accept={MEDIA_ACCEPT}
          label="Arraste mídias aqui"
          hint="Imagem, vídeo, áudio ou PDF, até 50 MB cada."
          onFiles={(files) => void uploadMedia(files)}
        />
        <UploadList items={mediaUploads} onDismiss={(id) => doneUpload(setMediaUploads, id)} />

        {mediaQ.isLoading ? (
          <Spinner label="Carregando mídias..." />
        ) : mediaQ.error ? (
          <Notice tone="red">{errorMessage(mediaQ.error, 'Falha ao carregar as mídias')}</Notice>
        ) : media.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma mídia. O agente só envia texto.</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {media.map((m) => (
              <MediaCard
                key={m.id}
                media={m}
                otherNames={media.filter((x) => x.id !== m.id).map((x) => x.name)}
                busy={busyId === m.id}
                onInsert={onInsertMedia}
                onSave={(patch) => runBusy(m.id, () => updateMedia.mutateAsync({ mediaId: m.id, ...patch }), 'Mídia atualizada', 'Falha ao atualizar a mídia')}
                onRenamed={onRenameMedia}
                onDelete={() => setConfirm({ kind: 'media', id: m.id, name: m.name })}
                onInvalidName={(message) => showToast(message, 'error')}
              />
            ))}
          </div>
        )}
      </Panel>

      <ConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={confirmDelete}
        title={confirm?.kind === 'doc' ? 'Excluir documento?' : 'Excluir mídia?'}
        message={
          confirm?.kind === 'doc'
            ? `"${confirm?.name}" e os trechos indexados serão apagados. O agente deixa de consultar este documento.`
            : `"${confirm?.name}" será apagada. Marcadores [[midia:${confirm?.name}]] no roteiro deixam de funcionar.`
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
};

export default KnowledgePanel;
