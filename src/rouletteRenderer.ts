import { Camera } from './camera';
import { canvasHeight, canvasWidth, DefaultBloomColor, DefaultEntityColor, initialZoom } from './data/constants';
import { StageDef } from './data/maps';
import { GameObject } from './gameObject';
import { Marble } from './marble';
import { ParticleManager } from './particleManager';
import { MapEntityState } from './types/MapEntity.type';
import { VectorLike } from './types/VectorLike';
import { UIObject } from './UIObject';

export type RenderParameters = {
  camera: Camera;
  stage: StageDef;
  entities: MapEntityState[];
  marbles: Marble[];
  winners: Marble[];
  particleManager: ParticleManager;
  effects: GameObject[];
  winnerRank: number;
  winningRange: number;
  winner: Marble | null;
  size: VectorLike;
};

export class RouletteRenderer {
  private _canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  public sizeFactor = 1;

  private _images: { [key: string]: HTMLImageElement } = {};

  constructor() {}

  get width() {
    return this._canvas.width;
  }

  get height() {
    return this._canvas.height;
  }

  get canvas() {
    return this._canvas;
  }

  async init() {
    await this._load();

    this._canvas = document.createElement('canvas');
    this._canvas.width = canvasWidth;
    this._canvas.height = canvasHeight;
    this.ctx = this._canvas.getContext('2d', {
      alpha: false,
    }) as CanvasRenderingContext2D;

    document.body.appendChild(this._canvas);

    const resizing = (entries?: ResizeObserverEntry[]) => {
      const realSize = entries ? entries[0].contentRect : this._canvas.getBoundingClientRect();
      const width = Math.max(realSize.width / 2, 640);
      const height = (width / realSize.width) * realSize.height;
      this._canvas.width = width;
      this._canvas.height = height;
      this.sizeFactor = width / realSize.width;
    };

    const resizeObserver = new ResizeObserver(resizing);

    resizeObserver.observe(this._canvas);
    resizing();
  }

  private async _load(): Promise<void> {
    return new Promise((rs) => {
      const imageUrl = new URL('/assets/images/chamru.png', import.meta.url);
      this._images['챔루'] = new Image();
      this._images['챔루'].src = imageUrl.toString();
      this._images['챔루'].addEventListener('load', () => {
        rs();
      });
    });
  }

  render(renderParameters: RenderParameters, uiObjects: UIObject[]) {
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    this.ctx.save();
    this.ctx.scale(initialZoom, initialZoom);
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.font = '0.4pt sans-serif';
    this.ctx.lineWidth = 3 / (renderParameters.camera.zoom + initialZoom);
    renderParameters.camera.renderScene(this.ctx, () => {
      this.renderEntities(renderParameters.entities);
      this.renderEffects(renderParameters);
      this.renderMarbles(renderParameters);
    });
    this.ctx.restore();

    uiObjects.forEach((obj) => obj.render(this.ctx, renderParameters, this._canvas.width, this._canvas.height));
    renderParameters.particleManager.render(this.ctx);
    this.renderWinner(renderParameters);
  }

  private renderEntities(entities: MapEntityState[]) {
    this.ctx.save();
    entities.forEach((entity) => {
      this.ctx.save();
      this.ctx.translate(entity.x, entity.y);
      this.ctx.rotate(entity.angle);
      this.ctx.fillStyle = entity.shape.color ?? DefaultEntityColor[entity.shape.type];
      this.ctx.strokeStyle = entity.shape.color ?? DefaultEntityColor[entity.shape.type];
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = entity.shape.bloomColor ?? entity.shape.color ?? DefaultBloomColor[entity.shape.type];
      const shape = entity.shape;
      switch (shape.type) {
        case 'polyline':
          if (shape.points.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(shape.points[0][0], shape.points[0][1]);
            for (let i = 1; i < shape.points.length; i++) {
              this.ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            }
            this.ctx.stroke();
          }
          break;
        case 'box':
          const w = shape.width * 2;
          const h = shape.height * 2;
          this.ctx.rotate(shape.rotation);
          this.ctx.fillRect(-w / 2, -h / 2, w, h);
          this.ctx.strokeRect(-w / 2, -h / 2, w, h);
          break;
        case 'circle':
          this.ctx.beginPath();
          this.ctx.arc(0, 0, shape.radius, 0, Math.PI * 2, false);
          this.ctx.stroke();
          break;
      }

      this.ctx.restore();
    });
    this.ctx.restore();
  }

  private renderEffects({ effects, camera }: RenderParameters) {
    effects.forEach((effect) => effect.render(this.ctx, camera.zoom * initialZoom));
  }

  private renderMarbles({ marbles, camera, winnerRank, winningRange, winners }: RenderParameters) {
    const winnerIndex = winnerRank - winners.length;

    marbles.forEach((marble, i) => {
      // Range 모드에서는 상위 winningRange 만큼의 구슬을 하이라이트
      const isHighlighted = winningRange > 1 ? i < winningRange : i === winnerIndex;

      marble.render(this.ctx, camera.zoom * initialZoom, isHighlighted, false, this._images[marble.name] || undefined);
    });
  }

  private renderWinner({ winner, winners, winningRange }: RenderParameters) {
    if (!winner) return;

    this.ctx.save();

    // Range 모드일 때는 다중 승자 표시
    if (winningRange > 1 && winners.length > 0) {
      const displayWinners = winners.slice(0, winningRange); // winningRange 만큼만 표시
      const bgHeight = Math.max(168, 60 + displayWinners.length * 40);
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      this.ctx.fillRect(this._canvas.width / 2, this._canvas.height - bgHeight, this._canvas.width / 2, bgHeight);

      this.ctx.fillStyle = 'white';
      this.ctx.font = 'bold 48px sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(`Winners (1-${winningRange})`, this._canvas.width - 10, this._canvas.height - bgHeight + 20);

      // 각 승자를 순서대로 표시 (winningRange 만큼만)
      this.ctx.font = 'bold 32px sans-serif';
      displayWinners.forEach((winnerMarble, index) => {
        this.ctx.fillStyle = winnerMarble.color;
        this.ctx.fillText(
          `${index + 1}. ${winnerMarble.name}`,
          this._canvas.width - 10,
          this._canvas.height - bgHeight + 80 + index * 40
        );
      });
    } else {
      // 기존 단일 승자 표시
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      this.ctx.fillRect(this._canvas.width / 2, this._canvas.height - 168, this._canvas.width / 2, 168);
      this.ctx.fillStyle = 'white';
      this.ctx.font = 'bold 48px sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.fillText('Winner', this._canvas.width - 10, this._canvas.height - 120);
      this.ctx.font = 'bold 72px sans-serif';
      this.ctx.fillStyle = winner.color;
      this.ctx.fillText(winner.name, this._canvas.width - 10, this._canvas.height - 55);
    }

    this.ctx.restore();
  }
}
