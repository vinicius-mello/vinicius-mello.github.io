// Teclas que não são operações: navegação e comandos da interface. São só
// dados (texto via i18n); o app liga cada comando à sua ação, e o painel
// de ajuda e a folha de atalhos (cheatsheet.html) os listam.

// Comandos: maiúsculas (Shift) e alguns símbolos.
export const COMMANDS = [
  { id: 'color', key: 'C', label: 'keys.color' },
  { id: 'edit', key: 'E', label: 'keys.edit' },
  { id: 'latex', key: 'L', label: 'keys.latex' },
  { id: 'present', key: 'P', label: 'keys.present' },
  { id: 'keyboard', key: 'K', label: 'keys.keyboard' },
  { id: 'note', key: 'O', label: 'keys.note' },
  { id: 'record', key: 'R', label: 'keys.record' },
  { id: 'zoomIn', key: ']', label: 'keys.zoomIn' },
  { id: 'zoomOut', key: '[', label: 'keys.zoomOut' },
  { id: 'zoomReset', key: '\\', label: 'keys.zoomReset' },
  { id: 'help', key: '?', label: 'keys.help' },
];

// Navegação e passos. Cada item: teclas (cada uma vira um <kbd>) e rótulo.
// "Space" é traduzido (Espaço / Space).
export const NAV_KEYS = [
  [['←', '→', '↑', '↓'], 'keys.nav'],
  [['Ctrl', '← →'], 'keys.move'],
  [['Ctrl', '↑ ↓'], 'keys.group'],
  [['Shift', '← →'], 'keys.extend'],
  [['Space'], 'keys.select'],
  [['Esc'], 'keys.esc'],
  [['Enter'], 'keys.ops'],
  [['Tab'], 'keys.tabs'],
  [['PgUp', 'PgDn', 'Home', 'End'], 'keys.steps'],
  [['Ctrl', 'Z'], 'keys.undo'],
  [['Ctrl', 'Shift', 'Z'], 'keys.redo'],
];
