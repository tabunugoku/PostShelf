import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { COLORS, FOLDER_ICON, MAIN_ICONS, MORE_ICONS, colorLabel, displayName, iconLabel, type Folder } from '../shared/models';
import { t } from '../shared/strings';
import { createFolder, StorageError, updateFolder } from '../shared/storage';
import { hasSameName } from '../shared/folderCreateMenu';

/**
 * フォルダの編集ポップオーバーの中身 (名前 / アイコン / 色 (色なし含む))。
 * folder が無ければ作成。選択は下書きにだけ反映し、保存 / Enter でまとめて保存する。
 */
/** existing: 同名の判定に使う、ほかのフォルダ (「未分類」を含む。このフォルダ自身は含めない) */
export function FolderEdit(props: {
  folder?: Folder;
  existing?: Folder[];
  onSaved: (created?: Folder) => void;
  onRequestDelete?: () => void;
}) {
  const folder = useRef(props.folder).current;
  const [name, setName] = useState(folder ? displayName(folder) : '');
  const [icon, setIcon] = useState(folder?.icon ?? FOLDER_ICON);
  const [color, setColor] = useState(folder?.color);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [moreIcons, setMoreIcons] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const extraIcon = !(MAIN_ICONS as readonly string[]).includes(icon);
  const moreLabel = extraIcon ? `${t('iconMore')}: ${iconLabel(icon)}` : t('iconMore');
  const busy = useRef(false);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return () => { mounted.current = false; };
  }, []);

  const save = async () => {
    if (busy.current) return;
    const trimmed = name.trim();
    if (!trimmed) return setError(t('errEmptyName'));
    if (hasSameName((props.existing ?? []).filter((f) => f.id !== folder?.id), trimmed)) return setError(t('errDuplicateFolder'));
    const patch: Parameters<typeof updateFolder>[1] = {};
    if (folder) {
      if (trimmed !== folder.name) patch.name = trimmed;
      if (icon !== folder.icon) patch.icon = icon;
      if (color !== folder.color) patch.color = color ?? null;
      if (!Object.keys(patch).length) return props.onSaved();
    }
    busy.current = true;
    setSaving(true);
    try {
      let created: Folder | undefined;
      if (folder) await updateFolder(folder.id, patch);
      else created = await createFolder({ name: trimmed, icon, color });
      if (mounted.current) props.onSaved(created);
    } catch (e) {
      if (mounted.current) setError(e instanceof StorageError ? e.message : t('errorStorage'));
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div class="folder-edit">
      <div class="erow">
        <span class="elabel">{t('name')}</span>
        <input
          ref={input}
          class="grow"
          value={name}
          disabled={saving}
          aria-label={t('name')}
          onInput={(e) => { setName((e.target as HTMLInputElement).value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
        />
      </div>
      <div class="erow folder-icon-row">
        <span class="elabel">{t('icon')}</span>
        {MAIN_ICONS.map((i) => (
          <button class={`ic${i === icon ? ' on' : ''}`} aria-label={iconLabel(i)} data-icon={i} aria-pressed={i === icon} disabled={saving} onClick={() => setIcon(i)}>
            <Icon name={i} />
          </button>
        ))}
        <button ref={moreButton} class={`ic icon-more${extraIcon ? ' on' : ''}`} aria-label={moreLabel} title={moreLabel}
          aria-pressed={extraIcon} aria-expanded={moreIcons} disabled={saving} onClick={() => setMoreIcons(!moreIcons)}>
          <Icon name={extraIcon ? icon : 'ti-dots'} />
        </button>
      </div>
      {moreIcons && <div class="folder-icon-grid">
        {MORE_ICONS.map(i => <button class={`ic${i === icon ? ' on' : ''}`} aria-label={iconLabel(i)}
          data-icon={i} aria-pressed={i === icon} disabled={saving} onClick={() => {
            setIcon(i);
            setMoreIcons(false);
            moreButton.current?.focus();
          }}><Icon name={i} /></button>)}
      </div>}
      <div class="erow wrap">
        <span class="elabel">{t('color')}</span>
        <button
          class={`sw sw-none${color === undefined ? ' on' : ''}`}
          aria-label={t('colorNone')}
          title={t('colorNone')}
          aria-pressed={color === undefined}
          disabled={saving}
          onClick={() => setColor(undefined)}
        />
        {COLORS.map((c) => (
          <button
            class={`sw${c === color ? ' on' : ''}`}
            style={{ background: c }}
            aria-label={colorLabel(c)}
            data-color={c}
            aria-pressed={c === color}
            disabled={saving}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      {error && <p class="error">{error}</p>}
      <div class="erow folder-actions">
        <button class="primary" disabled={saving || !name.trim()} onClick={() => void save()}>{t('save')}</button>
        {folder && <button class="danger" disabled={saving} onClick={props.onRequestDelete}>
          <Icon name="ti-trash" /> {t('delete')}
        </button>}
      </div>
    </div>
  );
}

