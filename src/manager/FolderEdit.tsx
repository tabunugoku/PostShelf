import { useEffect, useRef } from 'preact/hooks';
import type { Folder } from '../shared/models';
import { createFolderMenu } from '../shared/folderCreateMenu';

/** 共有の作成・編集メニューを載せる。下書きと保存処理は createFolderMenu に集約する。 */
export function FolderEdit(props: {
  folder?: Folder;
  existing?: Folder[];
  onSaved: (created?: Folder) => void;
  onCancel?: () => void;
  onRequestDelete?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    let mounted = true;
    const folder = props.folder;
    const menu = createFolderMenu({
      theme: { fg: 'var(--text-primary)', border: 'var(--border-strong)', hover: 'var(--fill-ghost-hover)', accent: 'var(--fill-accent)' },
      folder,
      head: false,
      preview: false,
      lockWhileSaving: true,
      existing: () => (latest.current.existing ?? []).filter(f => f.id !== folder?.id),
      onCreated: created => { if (mounted) latest.current.onSaved(created); },
      onSaved: () => { if (mounted) latest.current.onSaved(); },
      onClose: () => { if (mounted) latest.current.onCancel?.(); },
      onDelete: folder && props.onRequestDelete ? () => { if (mounted) latest.current.onRequestDelete?.(); } : undefined,
    });
    host.current?.replaceChildren(menu.el);
    menu.focus();
    menu.el.querySelector('input')?.select();
    return () => { mounted = false; };
  }, []);
  return <div ref={host} class="folder-editor-host" />;
}
