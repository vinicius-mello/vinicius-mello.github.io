// Histórico de passos: cada passo guarda a árvore (imutável), o foco e o
// rótulo da ação que o produziu. Serve de undo/redo e de log de derivação.

export class History {
  constructor() {
    this.steps = [];
    this.index = -1;
  }

  get current() {
    return this.steps[this.index];
  }

  // Um novo passo descarta o "futuro" desfeito.
  push(step) {
    this.steps = this.steps.slice(0, this.index + 1);
    this.steps.push(step);
    this.index++;
  }

  // Troca o passo atual (usado para juntar ajustes seguidos, como cores).
  replaceCurrent(step) {
    this.steps = this.steps.slice(0, this.index);
    this.steps.push(step);
  }

  undo() {
    if (this.index > 0) this.index--;
    return this.current;
  }

  redo() {
    if (this.index < this.steps.length - 1) this.index++;
    return this.current;
  }

  goto(i) {
    this.index = Math.max(0, Math.min(i, this.steps.length - 1));
    return this.current;
  }
}
