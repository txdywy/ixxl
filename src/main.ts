import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

type ElementKind = 'ice' | 'fire' | 'storm' | 'life' | 'sun' | 'void';
type SpecialKind = 'none' | 'nova' | 'line' | 'cross';

interface Cell {
  id: number;
  row: number;
  col: number;
  kind: ElementKind;
  special: SpecialKind;
}

interface FloatingText {
  element: HTMLDivElement;
  life: number;
  velocity: number;
}

const BOARD_SIZE = 7;
const CELL_GAP = 1.26;
const MAX_LEVELS = 8;
const ELEMENTS: ElementKind[] = ['ice', 'fire', 'storm', 'life', 'sun', 'void'];
const ELEMENT_THEME: Record<ElementKind, { color: number; emissive: number; name: string; score: number }> = {
  ice: { color: 0x83d7ff, emissive: 0x0b72aa, name: '霜晶', score: 90 },
  fire: { color: 0xff6a2a, emissive: 0xb82310, name: '焰核', score: 110 },
  storm: { color: 0xaa7bff, emissive: 0x5b22ee, name: '雷棱', score: 130 },
  life: { color: 0x4fe58c, emissive: 0x0a7b46, name: '森魂', score: 100 },
  sun: { color: 0xffd35a, emissive: 0xbf7b00, name: '日印', score: 120 },
  void: { color: 0x46506b, emissive: 0x141b38, name: '虚空', score: 150 },
};

const levelGoals = [
  { moves: 26, target: 1800, objective: '达成 1800 分，点燃第一道裂隙' },
  { moves: 25, target: 2700, objective: '连锁消除，稳定冰火边界' },
  { moves: 24, target: 3900, objective: '制造特殊元素，撕开雷云' },
  { moves: 23, target: 5200, objective: '收集高价值虚空元素' },
  { moves: 22, target: 6800, objective: '用连锁风暴压制裂隙' },
  { moves: 21, target: 8600, objective: '让冰、火、雷同时爆发' },
  { moves: 20, target: 10800, objective: '在终焰之前完成净化' },
  { moves: 19, target: 13500, objective: '封印元素王冠' },
];

class MatchGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  private composer: EffectComposer;
  private boardGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private gemMeshes = new Map<number, THREE.Mesh>();
  private gemTargets = new Map<number, THREE.Vector3>();
  private cells: Cell[][] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private selected: Cell | null = null;
  private idSeed = 0;
  private level = 1;
  private score = 0;
  private moves = levelGoals[0].moves;
  private combo = 1;
  private busy = false;
  private lastTime = 0;
  private floatingTexts: FloatingText[] = [];
  private particles: THREE.Points[] = [];
  private lightning: THREE.Line[] = [];
  private shockwaves: THREE.Mesh[] = [];
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private ui = {
    level: document.querySelector<HTMLSpanElement>('#level')!,
    moves: document.querySelector<HTMLSpanElement>('#moves')!,
    score: document.querySelector<HTMLSpanElement>('#score')!,
    combo: document.querySelector<HTMLSpanElement>('#combo')!,
    objective: document.querySelector<HTMLElement>('#objective')!,
    toast: document.querySelector<HTMLElement>('#toast')!,
    gameOver: document.querySelector<HTMLElement>('#game-over')!,
    resultTitle: document.querySelector<HTMLElement>('#result-title')!,
    resultCopy: document.querySelector<HTMLElement>('#result-copy')!,
  };

  constructor() {
    this.canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x070914, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.5, 0.2));

    this.setupScene();
    this.setupInput();
    this.startLevel(1);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    requestAnimationFrame((time) => this.tick(time));
  }

  private setupScene() {
    this.scene.fog = new THREE.FogExp2(0x080a18, 0.035);
    this.camera.position.set(0, 8.6, 11.8);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.boardGroup, this.fxGroup);

    const ambient = new THREE.HemisphereLight(0xaad7ff, 0x210611, 1.75);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 9, 7);
    const rim = new THREE.PointLight(0x8e6cff, 25, 24);
    rim.position.set(-5, 2, -5);
    const fire = new THREE.PointLight(0xff5121, 18, 18);
    fire.position.set(5, -1, 2);
    const ice = new THREE.PointLight(0x4ebcff, 14, 18);
    ice.position.set(-5, -1, 2);
    this.scene.add(ambient, key, rim, fire, ice);

    this.createWorldBackdrop();
    this.createBoardBase();
  }

  private createWorldBackdrop() {
    const skyGeo = new THREE.SphereGeometry(58, 36, 18);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x080b1b, side: THREE.BackSide });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);

    const starGeo = new THREE.BufferGeometry();
    const starPositions: number[] = [];
    const starColors: number[] = [];
    for (let i = 0; i < 460; i += 1) {
      const r = 24 + Math.random() * 32;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      starPositions.push(Math.cos(theta) * r, 5 + Math.sin(phi) * r * 0.65, Math.sin(theta) * r);
      const tint = new THREE.Color().setHSL(0.56 + Math.random() * 0.18, 0.7, 0.68);
      starColors.push(tint.r, tint.g, tint.b);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ size: 0.045, transparent: true, opacity: 0.82, vertexColors: true }),
    );
    this.scene.add(stars);

    const left = new THREE.Mesh(
      new THREE.ConeGeometry(4.4, 2.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x214b66, roughness: 0.9, emissive: 0x062c45, emissiveIntensity: 0.22 }),
    );
    left.position.set(-7.6, -4.8, -4.6);
    left.rotation.z = -0.18;
    const right = new THREE.Mesh(
      new THREE.ConeGeometry(4.7, 3.2, 7),
      new THREE.MeshStandardMaterial({ color: 0x5b2118, roughness: 0.9, emissive: 0x8e210c, emissiveIntensity: 0.38 }),
    );
    right.position.set(7.6, -4.9, -4.5);
    right.rotation.z = 0.2;
    this.scene.add(left, right);
  }

  private createBoardBase() {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_SIZE * CELL_GAP + 1.08, 0.42, BOARD_SIZE * CELL_GAP + 1.08),
      new THREE.MeshStandardMaterial({
        color: 0x15192a,
        metalness: 0.35,
        roughness: 0.38,
        emissive: 0x050713,
      }),
    );
    base.position.set(0, -0.36, 0);
    base.rotation.y = Math.PI / 4;
    this.boardGroup.add(base);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(BOARD_SIZE * CELL_GAP * 0.78, 0.04, 8, 128),
      new THREE.MeshBasicMaterial({ color: 0x7bdcff, transparent: true, opacity: 0.55 }),
    );
    ring.position.y = -0.12;
    ring.rotation.x = Math.PI / 2;
    this.boardGroup.add(ring);

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(1.03, 0.055, 1.03),
          new THREE.MeshStandardMaterial({
            color: (row + col) % 2 ? 0x20273d : 0x111827,
            metalness: 0.25,
            roughness: 0.5,
            emissive: 0x050816,
            emissiveIntensity: 0.45,
          }),
        );
        pad.position.copy(this.cellToPosition(row, col));
        pad.position.y = -0.12;
        this.boardGroup.add(pad);
      }
    }
  }

  private setupInput() {
    this.canvas.addEventListener('pointerdown', (event) => this.handlePointer(event));
    document.querySelector('#restart')!.addEventListener('click', () => this.startLevel(this.level));
    document.querySelector('#next-level')!.addEventListener('click', () => {
      this.ui.gameOver.hidden = true;
      this.startLevel((this.level % MAX_LEVELS) + 1);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'r') this.startLevel(this.level);
      if (event.key === 'Escape') this.clearSelection();
    });
  }

  private startLevel(level: number) {
    this.level = level;
    this.score = 0;
    this.moves = levelGoals[level - 1].moves;
    this.combo = 1;
    this.busy = false;
    this.clearBoardMeshes();
    this.cells = this.generateBoard();
    this.syncAllMeshes(true);
    this.updateHud();
    this.showToast('交换相邻元素，连成 3 个或更多');
  }

  private generateBoard(): Cell[][] {
    const board: Cell[][] = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      board[row] = [];
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        let kind = this.randomKind();
        let guard = 0;
        while (this.wouldCreateInitialMatch(board, row, col, kind) && guard < 24) {
          kind = this.randomKind();
          guard += 1;
        }
        board[row][col] = this.makeCell(row, col, kind);
      }
    }
    return board;
  }

  private randomKind(): ElementKind {
    const bias = Math.min(this.level - 1, 6) * 0.012;
    const roll = Math.random();
    if (roll < 0.07 + bias) return 'void';
    return ELEMENTS[Math.floor(Math.random() * (ELEMENTS.length - 1))];
  }

  private makeCell(row: number, col: number, kind = this.randomKind(), special: SpecialKind = 'none'): Cell {
    return { id: this.idSeed += 1, row, col, kind, special };
  }

  private wouldCreateInitialMatch(board: Cell[][], row: number, col: number, kind: ElementKind) {
    const left = col >= 2 && board[row][col - 1]?.kind === kind && board[row][col - 2]?.kind === kind;
    const up = row >= 2 && board[row - 1][col]?.kind === kind && board[row - 2][col]?.kind === kind;
    return left || up;
  }

  private async handlePointer(event: PointerEvent) {
    if (this.busy || this.ui.gameOver.hidden === false) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.gemMeshes.values()], false);
    if (!hits.length) {
      this.clearSelection();
      return;
    }
    const id = Number(hits[0].object.userData.id);
    const cell = this.findCell(id);
    if (!cell) return;
    if (!this.selected) {
      this.selectCell(cell);
      return;
    }
    if (this.selected.id === cell.id) {
      this.clearSelection();
      return;
    }
    if (this.areAdjacent(this.selected, cell)) {
      await this.trySwap(this.selected, cell);
    } else {
      this.selectCell(cell);
    }
  }

  private async trySwap(a: Cell, b: Cell) {
    this.busy = true;
    this.clearSelection();
    this.swapCells(a, b);
    this.syncAllMeshes(false);
    await this.sleep(210);
    const matches = this.findMatches();
    if (matches.length === 0) {
      this.swapCells(a, b);
      this.syncAllMeshes(false);
      this.showToast('这里没有形成元素共鸣');
      await this.sleep(220);
      this.busy = false;
      return;
    }
    this.moves -= 1;
    await this.resolveMatches(matches);
    this.updateHud();
    this.checkEnd();
    this.busy = false;
  }

  private async resolveMatches(initialMatches = this.findMatches()) {
    let matches = initialMatches;
    this.combo = 1;
    while (matches.length > 0) {
      const protectedSpecials = this.createSpecialsFromMatches(matches);
      const removed = new Set<Cell>();
      for (const line of matches) {
        line.forEach((cell) => {
          if (!protectedSpecials.has(cell.id)) removed.add(cell);
        });
      }
      this.score += [...removed].reduce((sum, cell) => sum + ELEMENT_THEME[cell.kind].score * this.combo, 0);
      for (const cell of removed) this.burstCell(cell, matches.length);
      this.updateHud();
      await this.sleep(this.reducedMotion ? 90 : 330);
      this.removeCells(removed);
      this.dropCells();
      this.syncAllMeshes(false);
      this.showFloatingText(`连锁 x${this.combo}`, window.innerWidth / 2, window.innerHeight * 0.28);
      await this.sleep(this.reducedMotion ? 100 : 360);
      this.combo += 1;
      matches = this.findMatches();
    }
    this.combo = Math.max(1, this.combo - 1);
    this.updateHud();
  }

  private createSpecialsFromMatches(matches: Cell[][]) {
    const protectedSpecials = new Set<number>();
    for (const match of matches) {
      if (match.length < 4) continue;
      const keeper = match[Math.floor(match.length / 2)];
      keeper.special = match.length >= 5 ? 'nova' : match[0].row === match[1].row ? 'line' : 'cross';
      this.decorateSpecial(keeper);
      protectedSpecials.add(keeper.id);
    }
    return protectedSpecials;
  }

  private findMatches(): Cell[][] {
    const matches: Cell[][] = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      let run: Cell[] = [this.cells[row][0]];
      for (let col = 1; col < BOARD_SIZE; col += 1) {
        const cell = this.cells[row][col];
        if (cell.kind === run[0].kind) run.push(cell);
        else {
          if (run.length >= 3) matches.push([...run]);
          run = [cell];
        }
      }
      if (run.length >= 3) matches.push([...run]);
    }
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      let run: Cell[] = [this.cells[0][col]];
      for (let row = 1; row < BOARD_SIZE; row += 1) {
        const cell = this.cells[row][col];
        if (cell.kind === run[0].kind) run.push(cell);
        else {
          if (run.length >= 3) matches.push([...run]);
          run = [cell];
        }
      }
      if (run.length >= 3) matches.push([...run]);
    }
    return matches;
  }

  private removeCells(removed: Set<Cell>) {
    const expanded = new Set<Cell>(removed);
    for (const cell of removed) {
      if (cell.special === 'nova') {
        for (const other of this.flattenCells()) {
          if (Math.abs(other.row - cell.row) <= 1 && Math.abs(other.col - cell.col) <= 1) expanded.add(other);
        }
      }
      if (cell.special === 'line' || cell.special === 'cross') {
        for (let i = 0; i < BOARD_SIZE; i += 1) expanded.add(this.cells[cell.row][i]);
      }
      if (cell.special === 'cross') {
        for (let i = 0; i < BOARD_SIZE; i += 1) expanded.add(this.cells[i][cell.col]);
      }
    }
    for (const cell of expanded) {
      const mesh = this.gemMeshes.get(cell.id);
      if (mesh) {
        mesh.parent?.remove(mesh);
        disposeObject(mesh);
        this.gemMeshes.delete(cell.id);
        this.gemTargets.delete(cell.id);
      }
      this.cells[cell.row][cell.col] = null as unknown as Cell;
    }
  }

  private dropCells() {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const survivors: Cell[] = [];
      for (let row = BOARD_SIZE - 1; row >= 0; row -= 1) {
        const cell = this.cells[row][col];
        if (cell) survivors.push(cell);
      }
      for (let row = BOARD_SIZE - 1; row >= 0; row -= 1) {
        const cell = survivors[BOARD_SIZE - 1 - row] ?? this.makeCell(row, col);
        cell.row = row;
        cell.col = col;
        this.cells[row][col] = cell;
        if (!this.gemMeshes.has(cell.id)) {
          this.createGemMesh(cell, true);
        }
      }
    }
  }

  private swapCells(a: Cell, b: Cell) {
    const aRow = a.row;
    const aCol = a.col;
    this.cells[a.row][a.col] = b;
    this.cells[b.row][b.col] = a;
    a.row = b.row;
    a.col = b.col;
    b.row = aRow;
    b.col = aCol;
  }

  private syncAllMeshes(immediate: boolean) {
    for (const cell of this.flattenCells()) {
      if (!this.gemMeshes.has(cell.id)) this.createGemMesh(cell, false);
      const target = this.cellToPosition(cell.row, cell.col);
      target.y = 0.38;
      this.gemTargets.set(cell.id, target);
      if (immediate) this.gemMeshes.get(cell.id)!.position.copy(target);
    }
  }

  private createGemMesh(cell: Cell, spawnHigh: boolean) {
    const mesh = new THREE.Mesh(this.gemGeometry(cell.kind), this.gemMaterial(cell.kind));
    mesh.userData.id = cell.id;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.position.copy(this.cellToPosition(cell.row, cell.col));
    mesh.position.y = spawnHigh ? 4.5 + Math.random() * 2 : 0.38;
    mesh.rotation.set(Math.random() * 0.18, Math.random() * Math.PI, Math.random() * 0.18);
    this.addGemDetails(mesh, cell.kind);
    this.boardGroup.add(mesh);
    this.gemMeshes.set(cell.id, mesh);
    this.decorateSpecial(cell);
  }

  private gemGeometry(kind: ElementKind) {
    if (kind === 'ice') return new THREE.OctahedronGeometry(0.58, 1);
    if (kind === 'fire') return new THREE.DodecahedronGeometry(0.61, 0);
    if (kind === 'storm') return new THREE.TetrahedronGeometry(0.74, 0);
    if (kind === 'life') return new THREE.IcosahedronGeometry(0.59, 1);
    if (kind === 'sun') return new THREE.TorusKnotGeometry(0.37, 0.16, 86, 12);
    return new THREE.BoxGeometry(0.78, 0.78, 0.78, 3, 3, 3);
  }

  private gemMaterial(kind: ElementKind) {
    const theme = ELEMENT_THEME[kind];
    return new THREE.MeshStandardMaterial({
      color: theme.color,
      emissive: theme.emissive,
      emissiveIntensity: kind === 'void' ? 0.86 : 0.58,
      metalness: kind === 'sun' ? 0.7 : 0.28,
      roughness: kind === 'ice' ? 0.1 : 0.26,
      transparent: true,
      opacity: kind === 'ice' ? 0.9 : 0.98,
    });
  }

  private addGemDetails(mesh: THREE.Mesh, kind: ElementKind) {
    const theme = ELEMENT_THEME[kind];
    const highlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: kind === 'void' ? 0.34 : 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    highlight.position.set(-0.13, 0.18, 0.22);
    highlight.scale.set(1, 0.62, 1);
    mesh.add(highlight);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 22, 14),
      new THREE.MeshBasicMaterial({
        color: theme.color,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    core.position.y = 0.04;
    mesh.add(core);

    if (kind === 'ice') {
      const shardMat = new THREE.MeshStandardMaterial({
        color: 0xd7f7ff,
        emissive: 0x48bfff,
        emissiveIntensity: 0.45,
        roughness: 0.08,
        transparent: true,
        opacity: 0.72,
      });
      for (let i = 0; i < 3; i += 1) {
        const shard = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.44, 4), shardMat.clone());
        shard.position.set(Math.cos(i * 2.1) * 0.32, 0.18, Math.sin(i * 2.1) * 0.32);
        shard.rotation.set(0.55, i * 2.1, 0.2);
        mesh.add(shard);
      }
    }

    if (kind === 'fire') {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.62, 7),
        new THREE.MeshBasicMaterial({ color: 0xffe18a, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending }),
      );
      flame.position.y = 0.3;
      flame.rotation.x = -0.18;
      mesh.add(flame);
    }

    if (kind === 'storm') {
      const boltPoints = [
        new THREE.Vector3(-0.16, 0.34, 0.12),
        new THREE.Vector3(0.08, 0.08, 0.08),
        new THREE.Vector3(-0.02, 0.08, 0.08),
        new THREE.Vector3(0.18, -0.28, 0.08),
      ];
      const bolt = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(boltPoints),
        new THREE.LineBasicMaterial({ color: 0xf5e9ff, transparent: true, opacity: 0.95 }),
      );
      mesh.add(bolt);
    }

    if (kind === 'life') {
      const leafMat = new THREE.MeshStandardMaterial({ color: 0xb9ffc8, emissive: 0x23d76f, emissiveIntensity: 0.42, roughness: 0.36 });
      for (let i = 0; i < 2; i += 1) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 10), leafMat.clone());
        leaf.scale.set(0.75, 1.7, 0.26);
        leaf.position.set(i === 0 ? -0.15 : 0.15, 0.24, 0.16);
        leaf.rotation.set(0.95, 0, i === 0 ? -0.55 : 0.55);
        mesh.add(leaf);
      }
    }

    if (kind === 'sun') {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.025, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0xfff2a4, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending }),
      );
      ring.rotation.x = Math.PI / 2;
      mesh.add(ring);
    }

    if (kind === 'void') {
      const rune = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.025, 5, 48),
        new THREE.MeshBasicMaterial({ color: 0x9d78ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }),
      );
      rune.rotation.set(Math.PI / 2, 0, Math.PI / 5);
      mesh.add(rune);
    }
  }

  private decorateSpecial(cell: Cell) {
    const mesh = this.gemMeshes.get(cell.id);
    if (!mesh) return;
    const oldAura = mesh.getObjectByName('special-aura');
    if (oldAura) {
      mesh.remove(oldAura);
      disposeObject(oldAura);
    }
    mesh.scale.setScalar(cell.special === 'nova' ? 1.24 : cell.special === 'none' ? 1 : 1.13);
    if (cell.special === 'none') return;
    const theme = ELEMENT_THEME[cell.kind];
    const aura = new THREE.Mesh(
      new THREE.TorusGeometry(cell.special === 'nova' ? 0.62 : 0.53, 0.026, 8, 72),
      new THREE.MeshBasicMaterial({
        color: cell.special === 'nova' ? 0xffffff : theme.color,
        transparent: true,
        opacity: cell.special === 'nova' ? 0.9 : 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    aura.name = 'special-aura';
    aura.rotation.x = Math.PI / 2;
    mesh.add(aura);
  }

  private burstCell(cell: Cell, intensity: number) {
    const position = this.cellToPosition(cell.row, cell.col);
    position.y = 0.55;
    const theme = ELEMENT_THEME[cell.kind];
    this.spawnParticles(position, theme.color, cell.kind, intensity);
    this.spawnShards(position, theme.color, cell.kind, intensity);
    this.spawnShockwave(position, theme.color, intensity, cell.special);
    if (cell.kind === 'storm' || cell.special === 'cross' || cell.special === 'nova') this.spawnLightning(position, theme.color, cell.special === 'nova' ? 7 : 4);
    if (cell.kind === 'fire') this.flashLight(position, 0xff4a16, 42);
    if (cell.kind === 'ice') this.flashLight(position, 0x6bd9ff, 34);
    if (cell.kind === 'sun') this.flashLight(position, 0xffe18a, 38);
    if (cell.kind === 'void') this.flashLight(position, 0x936dff, 36);
  }

  private spawnParticles(origin: THREE.Vector3, color: number, kind: ElementKind, intensity: number) {
    const count = this.reducedMotion ? 24 : 70 + intensity * 18;
    const positions: number[] = [];
    const velocities: number[] = [];
    for (let i = 0; i < count; i += 1) {
      positions.push(origin.x, origin.y, origin.z);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.035 + Math.random() * 0.105;
      velocities.push(Math.cos(angle) * speed, 0.035 + Math.random() * 0.12, Math.sin(angle) * speed);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: kind === 'ice' ? 0.095 : 0.13,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.life = 1;
    points.userData.gravity = kind === 'fire' ? 0.0004 : 0.0012;
    this.fxGroup.add(points);
    this.particles.push(points);
  }

  private spawnShards(origin: THREE.Vector3, color: number, kind: ElementKind, intensity: number) {
    const shardCount = this.reducedMotion ? 4 : 8 + intensity * 3;
    const shardMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.7,
      metalness: kind === 'sun' ? 0.65 : 0.18,
      roughness: 0.22,
      transparent: true,
      opacity: 0.92,
    });
    for (let i = 0; i < shardCount; i += 1) {
      const geometry =
        kind === 'storm'
          ? new THREE.TetrahedronGeometry(0.08 + Math.random() * 0.08)
          : new THREE.OctahedronGeometry(0.07 + Math.random() * 0.08);
      const shard = new THREE.Mesh(geometry, shardMaterial.clone());
      shard.position.copy(origin);
      shard.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.045 + Math.random() * 0.09;
      shard.userData.velocity = new THREE.Vector3(Math.cos(angle) * speed, 0.05 + Math.random() * 0.11, Math.sin(angle) * speed);
      shard.userData.spin = new THREE.Vector3(Math.random() * 0.16, Math.random() * 0.2, Math.random() * 0.16);
      shard.userData.life = 1;
      this.fxGroup.add(shard);
      this.shockwaves.push(shard);
    }
  }

  private spawnShockwave(origin: THREE.Vector3, color: number, intensity: number, special: SpecialKind) {
    const rings = special === 'nova' ? 3 : special === 'none' ? 1 : 2;
    for (let i = 0; i < rings; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.28 + i * 0.08, 0.025, 8, 96),
        new THREE.MeshBasicMaterial({
          color: i === 0 && special === 'nova' ? 0xffffff : color,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.position.copy(origin);
      ring.position.y += 0.03 + i * 0.05;
      ring.rotation.x = Math.PI / 2;
      ring.userData.life = 0.75 + i * 0.18;
      ring.userData.grow = 0.14 + intensity * 0.014 + i * 0.055;
      ring.userData.kind = 'ring';
      this.fxGroup.add(ring);
      this.shockwaves.push(ring);
    }

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, special === 'nova' ? 0.7 : 0.48, special === 'nova' ? 3.4 : 2.3, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: special === 'none' ? 0.16 : 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    column.position.copy(origin);
    column.position.y += special === 'nova' ? 1.45 : 0.95;
    column.userData.life = special === 'nova' ? 0.9 : 0.58;
    column.userData.grow = 0.045;
    column.userData.kind = 'column';
    this.fxGroup.add(column);
    this.shockwaves.push(column);
  }

  private spawnLightning(origin: THREE.Vector3, color: number, branchCount: number) {
    for (let branch = 0; branch < branchCount; branch += 1) {
      const points: THREE.Vector3[] = [];
      const end = origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.4, 0.65, (Math.random() - 0.5) * 3.4));
      for (let i = 0; i < 9; i += 1) {
        const t = i / 8;
        points.push(origin.clone().lerp(end, t).add(new THREE.Vector3((Math.random() - 0.5) * 0.28, Math.random() * 0.24, (Math.random() - 0.5) * 0.28)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending }),
      );
      line.userData.life = 0.28;
      this.fxGroup.add(line);
      this.lightning.push(line);
    }
  }

  private flashLight(origin: THREE.Vector3, color: number, intensity: number) {
    const light = new THREE.PointLight(color, intensity, 7.5);
    light.position.copy(origin);
    light.position.y += 0.75;
    light.userData.life = 0.42;
    this.fxGroup.add(light);
  }

  private tick(time: number) {
    const dt = Math.min((time - this.lastTime) / 16.67, 3) || 1;
    this.lastTime = time;
    this.animateBoard(time, dt);
    this.animateFx(dt);
    this.composer.render();
    requestAnimationFrame((next) => this.tick(next));
  }

  private animateBoard(time: number, dt: number) {
    this.boardGroup.rotation.x = -0.08 + Math.sin(time * 0.00042) * 0.01;
    this.boardGroup.rotation.y = Math.sin(time * 0.00022) * 0.06;
    for (const [id, mesh] of this.gemMeshes) {
      const target = this.gemTargets.get(id);
      if (target) mesh.position.lerp(target, 0.16 * dt);
      mesh.rotation.y += 0.012 * dt;
      mesh.position.y += Math.sin(time * 0.003 + id) * 0.0025;
    }
  }

  private animateFx(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const points = this.particles[i];
      points.userData.life -= 0.026 * dt;
      const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const vel = points.geometry.getAttribute('velocity') as THREE.BufferAttribute;
      for (let p = 0; p < pos.count; p += 1) {
        vel.setY(p, vel.getY(p) - points.userData.gravity * dt);
        pos.setXYZ(p, pos.getX(p) + vel.getX(p) * dt, pos.getY(p) + vel.getY(p) * dt, pos.getZ(p) + vel.getZ(p) * dt);
      }
      pos.needsUpdate = true;
      (points.material as THREE.PointsMaterial).opacity = Math.max(points.userData.life, 0);
      if (points.userData.life <= 0) {
        this.fxGroup.remove(points);
        disposeObject(points);
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.lightning.length - 1; i >= 0; i -= 1) {
      const line = this.lightning[i];
      line.userData.life -= 0.05 * dt;
      (line.material as THREE.LineBasicMaterial).opacity = Math.max(line.userData.life * 3, 0);
      if (line.userData.life <= 0) {
        this.fxGroup.remove(line);
        disposeObject(line);
        this.lightning.splice(i, 1);
      }
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i -= 1) {
      const object = this.shockwaves[i];
      object.userData.life -= 0.024 * dt;
      if (object.userData.velocity instanceof THREE.Vector3) {
        object.position.addScaledVector(object.userData.velocity, dt);
        object.userData.velocity.y -= 0.0045 * dt;
      }
      if (object.userData.spin instanceof THREE.Vector3) {
        object.rotation.x += object.userData.spin.x * dt;
        object.rotation.y += object.userData.spin.y * dt;
        object.rotation.z += object.userData.spin.z * dt;
      }
      if (object.userData.kind === 'ring') {
        object.scale.x += object.userData.grow * dt;
        object.scale.y += object.userData.grow * dt;
        object.scale.z += object.userData.grow * dt;
      } else if (object.userData.kind === 'column') {
        object.scale.x += object.userData.grow * dt;
        object.scale.z += object.userData.grow * dt;
      }
      const material = object.material;
      if (material instanceof THREE.Material) {
        material.opacity = Math.max(object.userData.life, 0);
      }
      if (object.userData.life <= 0) {
        this.fxGroup.remove(object);
        disposeObject(object);
        this.shockwaves.splice(i, 1);
      }
    }
    for (let i = this.fxGroup.children.length - 1; i >= 0; i -= 1) {
      const child = this.fxGroup.children[i];
      if (!(child instanceof THREE.PointLight) || child.userData.life === undefined) continue;
      child.userData.life -= 0.035 * dt;
      child.intensity *= 0.9;
      if (child.userData.life <= 0) this.fxGroup.remove(child);
    }
    for (let i = this.floatingTexts.length - 1; i >= 0; i -= 1) {
      const item = this.floatingTexts[i];
      item.life -= 0.018 * dt;
      item.velocity += 0.018 * dt;
      item.element.style.transform = `translate(-50%, calc(-50% - ${item.velocity}px))`;
      item.element.style.opacity = String(Math.max(item.life, 0));
      if (item.life <= 0) {
        item.element.remove();
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  private selectCell(cell: Cell) {
    this.clearSelection();
    this.selected = cell;
    const mesh = this.gemMeshes.get(cell.id);
    if (mesh) mesh.scale.multiplyScalar(1.2);
    this.showToast(`${ELEMENT_THEME[cell.kind].name} 已选中`);
  }

  private clearSelection() {
    if (this.selected) this.decorateSpecial(this.selected);
    this.selected = null;
  }

  private updateHud() {
    const goal = levelGoals[this.level - 1];
    this.ui.level.textContent = String(this.level);
    this.ui.moves.textContent = String(this.moves);
    this.ui.score.textContent = String(this.score);
    this.ui.combo.textContent = `x${Math.max(this.combo, 1)}`;
    this.ui.objective.textContent = `${goal.objective} · ${this.score}/${goal.target}`;
  }

  private checkEnd() {
    const goal = levelGoals[this.level - 1];
    if (this.score >= goal.target) {
      this.ui.resultTitle.textContent = '裂隙稳定';
      this.ui.resultCopy.textContent = `第 ${this.level} 关完成，剩余 ${this.moves} 步。`;
      this.ui.gameOver.hidden = false;
      return;
    }
    if (this.moves <= 0) {
      this.ui.resultTitle.textContent = '风暴回卷';
      this.ui.resultCopy.textContent = `距离目标还差 ${goal.target - this.score} 分，再试一次会更接近。`;
      this.ui.gameOver.hidden = false;
    }
  }

  private showToast(message: string) {
    this.ui.toast.textContent = message;
    this.ui.toast.classList.remove('toast--show');
    window.requestAnimationFrame(() => this.ui.toast.classList.add('toast--show'));
  }

  private showFloatingText(message: string, x: number, y: number) {
    const element = document.createElement('div');
    element.className = 'float-text';
    element.textContent = message;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    document.body.appendChild(element);
    this.floatingTexts.push({ element, life: 1, velocity: 0 });
  }

  private resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    const compact = width < 760 || height > width * 1.25;
    this.boardGroup.scale.setScalar(compact ? 0.74 : 1.04);
    this.camera.position.set(0, compact ? 14.8 : 10.8, compact ? 12.8 : 11.4);
    this.camera.fov = compact ? 72 : 49;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private cellToPosition(row: number, col: number) {
    const x = (col - (BOARD_SIZE - 1) / 2) * CELL_GAP;
    const z = (row - (BOARD_SIZE - 1) / 2) * CELL_GAP;
    return new THREE.Vector3(x, 0, z);
  }

  private findCell(id: number) {
    return this.flattenCells().find((cell) => cell.id === id) ?? null;
  }

  private flattenCells() {
    return this.cells.flat().filter(Boolean);
  }

  private areAdjacent(a: Cell, b: Cell) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
  }

  private clearBoardMeshes() {
    for (const mesh of this.gemMeshes.values()) {
      mesh.parent?.remove(mesh);
      disposeObject(mesh);
    }
    this.gemMeshes.clear();
    this.gemTargets.clear();
    this.clearSelection();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function disposeObject(object: THREE.Object3D) {
  for (const child of [...object.children]) {
    object.remove(child);
    disposeObject(child);
  }
  if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) object.geometry.dispose();
  const material = 'material' in object ? object.material : null;
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else if (material instanceof THREE.Material) material.dispose();
}

new MatchGame();
