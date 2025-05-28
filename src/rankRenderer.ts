import { RenderParameters } from './rouletteRenderer';
import { Rect } from './types/rect.type';
import { UIObject } from './UIObject';
import { bound } from './utils/bound.decorator';

export class RankRenderer implements UIObject {
  private _currentY = 0;
  private _targetY = 0;
  private fontHeight = 16;
  private _userMoved = 0;
  private _currentWinner = -1;
  private maxY = 0;

  constructor() {}

  @bound
  onWheel(e: WheelEvent) {
    this._targetY += e.deltaY;
    if (this._targetY > this.maxY) {
      this._targetY = this.maxY;
    }
    this._userMoved = 2000;
  }

  render(
    ctx: CanvasRenderingContext2D,
    { winners, marbles, winnerRank, winningRange, duplicateMarbles }: RenderParameters,
    width: number,
    height: number
  ) {
    const startX = width - 5;
    const startY = Math.max(-this.fontHeight, this._currentY - height / 2);
    const totalItems = marbles.length + winners.length + (duplicateMarbles?.length || 0);
    this.maxY = Math.max(0, totalItems * this.fontHeight + this.fontHeight);
    this._currentWinner = winners.length;

    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = '10pt sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText(`${winners.length} / ${winners.length + marbles.length}`, width - 5, this.fontHeight);

    ctx.beginPath();
    ctx.rect(0, this.fontHeight + 2, width, this.maxY);
    ctx.clip();

    ctx.translate(0, -startY);

    let currentRank = 0;

    // Render winners
    ctx.font = 'bold 11pt sans-serif';
    winners.forEach((marble: { color: string; name: string }, index: number) => {
      const y = currentRank * this.fontHeight;
      if (y >= startY && y <= startY + ctx.canvas.height) {
        ctx.fillStyle = marble.color;
        // Range mode: use star for range winners, check for target winner
        const symbol = winningRange > 1 ? '★' : index === winnerRank ? '☆' : '\u2714';
        ctx.fillText(`${symbol} ${marble.name} #${index + 1}`, startX, 20 + y);
      }
      currentRank++;
    });

    // Render duplicates (if any)
    if (duplicateMarbles && duplicateMarbles.length > 0) {
      ctx.font = '10pt sans-serif';
      duplicateMarbles.forEach((marble: { color: string; name: string }) => {
        const y = currentRank * this.fontHeight;
        if (y >= startY && y <= startY + ctx.canvas.height) {
          ctx.fillStyle = marble.color;
          ctx.fillText(`− ${marble.name} (중복)`, startX, 20 + y);
        }
        currentRank++;
      });
    }

    // Render remaining marbles
    ctx.font = '10pt sans-serif';
    marbles.forEach((marble: { color: string; name: string }, index: number) => {
      const y = currentRank * this.fontHeight;
      if (y >= startY && y <= startY + ctx.canvas.height) {
        ctx.fillStyle = marble.color;
        ctx.fillText(`${marble.name} #${currentRank + 1}`, startX, 20 + y);
      }
      currentRank++;
    });

    ctx.restore();
  }

  update(deltaTime: number) {
    if (this._currentWinner === -1) {
      return;
    }
    if (this._userMoved > 0) {
      this._userMoved -= deltaTime;
    } else {
      this._targetY = this._currentWinner * this.fontHeight + this.fontHeight;
    }
    if (this._currentY !== this._targetY) {
      this._currentY += (this._targetY - this._currentY) * (deltaTime / 250);
    }
    if (Math.abs(this._currentY - this._targetY) < 1) {
      this._currentY = this._targetY;
    }
  }

  getBoundingBox(): Rect | null {
    return null;
  }
}
