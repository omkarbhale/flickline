import { parseSave, type SaveParts } from '../settings/saveData';
import { button, h } from './kit/kit';

/** What the Data group needs from the game: the save text, applying an import, and the reset. */
export interface DataHost {
  /** The current save as JSON text. */
  exportSave(): string;
  /** Apply the parts of an imported save (already validated). */
  importSave(parts: SaveParts): void;
  /** Reset progress (profile and the progress save); settings are kept. */
  resetProgress(): void;
  /** The play journal's one line ("4 sessions this week, 11 runs, 7 started straight after the last"). */
  journalLine(): string;
  /** The play journal alone as compact JSON text, for pasting on a playtest (#214). */
  exportJournal(): string;
}

/**
 * The Data group (design §13.3): export the save as JSON (download or copy), import one (a file or
 * pasted text, validated before anything changes), and reset progress behind a two-step confirm
 * (the first press arms it, the second does it, Cancel or leaving the tab disarms it). The game
 * reloads after an import or reset so every part of it starts from the new data.
 */
export class DataPanel {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly paste: HTMLTextAreaElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly confirmRow: HTMLElement;
  private readonly journalNote: HTMLElement;

  constructor(private readonly host: DataHost, private readonly reload: () => void = () => window.location.reload()) {
    this.status = h('p', { class: 'set-status', attrs: { role: 'status', 'aria-live': 'polite' } });

    const download = button('Download save', { variant: 'secondary', onClick: () => this.download() });
    download.dataset.k = 'export';
    const copy = button('Copy save', { variant: 'ghost', onClick: () => void this.copy() });
    copy.dataset.k = 'copy';

    const copyJournal = button('Copy play journal', { variant: 'ghost', onClick: () => void this.copyJournal() });
    copyJournal.dataset.k = 'copyJournal';
    this.journalNote = h('p', { class: 'note', attrs: { 'data-k': 'journalLine' } });

    const file = h('input', { attrs: { type: 'file', accept: 'application/json,.json', 'data-k': 'importFile', id: 'set-import-file', 'aria-label': 'Import a save file' } });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((t) => this.apply(t), () => this.say('That file could not be read.', true));
      file.value = '';
    });

    this.paste = h('textarea', { attrs: { rows: '3', 'data-k': 'importText', id: 'set-import-text', 'aria-label': 'Paste a save here', placeholder: 'Or paste a save here', spellcheck: 'false' } });
    const importBtn = button('Import pasted save', { variant: 'secondary', onClick: () => this.apply(this.paste.value) });
    importBtn.dataset.k = 'importPaste';

    this.resetBtn = button('Reset progress…', { variant: 'secondary', onClick: () => this.arm() });
    this.resetBtn.dataset.k = 'reset';
    const yes = button('Yes, reset my progress', { variant: 'primary', onClick: () => this.reset() });
    yes.dataset.k = 'resetConfirm';
    const no = button('Cancel', { variant: 'ghost', onClick: () => this.disarm(true) });
    no.dataset.k = 'resetCancel';
    this.confirmRow = h('div', { class: 'set-actions set-confirm', attrs: { role: 'alertdialog', 'aria-label': 'Confirm reset' } }, [
      h('p', { class: 'set-warning', text: 'This erases your ratings, bests and run counts on this device. Your settings stay. Download a save first if you want a backup.' }),
      yes,
      no,
    ]);
    this.confirmRow.hidden = true;
    this.refresh();

    this.el = h('div', { class: 'set-section' }, [
      h('h3', { class: 'set-group', text: 'Save' }),
      h('p', { class: 'note', text: 'Your settings, profile and personal bests, as one file you can keep or move to another browser.' }),
      h('div', { class: 'set-actions' }, [download, copy]),
      h('h3', { class: 'set-group', text: 'Play journal' }),
      h('p', { class: 'note', text: 'A record of when you played, kept on this device and in your save. Nothing is sent anywhere and nothing is earned by it.' }),
      this.journalNote,
      h('div', { class: 'set-actions' }, [copyJournal]),
      h('h3', { class: 'set-group', text: 'Import' }),
      h('div', { class: 'set-actions' }, [file]),
      this.paste,
      h('div', { class: 'set-actions' }, [importBtn]),
      h('h3', { class: 'set-group', text: 'Reset' }),
      h('div', { class: 'set-actions' }, [this.resetBtn]),
      this.confirmRow,
      this.status,
    ]);
  }

  /** Read the journal line again (the tab is shown, or a run just ended). */
  refresh(): void {
    this.journalNote.textContent = this.host.journalLine();
  }

  /** Leaving the tab disarms the reset. */
  disarm(focusBack = false): void {
    this.confirmRow.hidden = true;
    this.resetBtn.hidden = false;
    if (focusBack) this.resetBtn.focus();
  }

  private arm(): void {
    this.resetBtn.hidden = true;
    this.confirmRow.hidden = false;
    this.confirmRow.querySelector<HTMLElement>('[data-k="resetCancel"]')!.focus(); // the safe choice has the focus
  }

  private reset(): void {
    this.host.resetProgress();
    this.say('Progress reset. Reloading…');
    this.reload();
  }

  private download(): void {
    const text = this.host.exportSave();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { attrs: { href: url, download: `flickline-save-${new Date().toISOString().slice(0, 10)}.json` } });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.say('Save downloaded.');
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.host.exportSave());
      this.say('Save copied to the clipboard.');
    } catch {
      this.paste.value = this.host.exportSave();
      this.paste.select();
      this.say('Could not use the clipboard; the save is in the box below, copy it from there.', true);
    }
  }

  private async copyJournal(): Promise<void> {
    const text = this.host.exportJournal();
    try {
      await navigator.clipboard.writeText(text);
      this.say('Play journal copied to the clipboard.');
    } catch {
      this.paste.value = text;
      this.paste.select();
      this.say('Could not use the clipboard; the journal is in the box below, copy it from there.', true);
    }
  }

  /** Validate and apply an imported save text. Nothing changes unless the whole text is a good save. */
  apply(text: string): void {
    const r = parseSave(text);
    if (!r.ok) {
      this.say(r.error, true);
      return;
    }
    this.host.importSave(r.parts);
    this.say('Save imported. Reloading…');
    this.reload();
  }

  private say(text: string, warn = false): void {
    this.status.textContent = text;
    this.status.dataset.tone = warn ? 'warn' : 'info';
  }

  get message(): string {
    return this.status.textContent ?? '';
  }
}
