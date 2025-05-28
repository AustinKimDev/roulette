import { IPhysics } from './IPhysics';
import { UIObject } from './UIObject';
import { Camera } from './camera';
import { initialZoom, Skills, zoomThreshold } from './data/constants';
import { StageDef, stages } from './data/maps';
import { GameObject } from './gameObject';
import { Marble } from './marble';
import { Minimap } from './minimap';
import options from './options';
import { ParticleManager } from './particleManager';
import { Box2dPhysics } from './physics-box2d';
import { RankRenderer } from './rankRenderer';
import { RouletteRenderer } from './rouletteRenderer';
import { SkillEffect } from './skillEffect';
import { bound } from './utils/bound.decorator';
import { parseName } from './utils/utils';
import { VideoRecorder } from './utils/videoRecorder';

export class Roulette extends EventTarget {
  private _marbles: Marble[] = [];

  private _lastTime: number = 0;
  private _elapsed: number = 0;
  private _noMoveDuration: number = 0;
  private _shakeAvailable: boolean = false;

  private _updateInterval = 10;
  private _timeScale = 1;
  private _speed = 1;

  private _winners: Marble[] = [];
  private _duplicateMarbles: Marble[] = []; // 중복으로 제외된 구슬들을 추적
  private _particleManager = new ParticleManager();
  private _stage: StageDef | null = null;

  private _camera: Camera = new Camera();
  private _renderer: RouletteRenderer = new RouletteRenderer();

  private _effects: GameObject[] = [];

  private _winnerRank = 0;
  private _totalMarbleCount = 0;
  private _goalDist: number = Infinity;
  private _isRunning: boolean = false;
  private _winner: Marble | null = null;
  private _winningRange: number = 1;

  private _uiObjects: UIObject[] = [];

  private _autoRecording: boolean = false;
  private _recorder!: VideoRecorder;

  private physics!: IPhysics;

  private _isReady: boolean = false;

  // 무한 반복 관련 속성
  private _infiniteLoop: boolean = false;
  private _loopDelay: number = 5000;
  private _loopTimeoutId: number | null = null;
  private _savedNames: string[] = [];

  private _preventDuplicateWinnersInRangeMode: boolean = false;

  get isReady() {
    return this._isReady;
  }

  constructor() {
    super();
    this._renderer.init().then(() => {
      this._init().then(() => {
        this._isReady = true;
        this._update();
      });
    });
  }

  public getZoom() {
    return initialZoom * this._camera.zoom;
  }

  private addUiObject(obj: UIObject) {
    this._uiObjects.push(obj);
    if (obj.onWheel) {
      this._renderer.canvas.addEventListener('wheel', obj.onWheel);
    }
  }

  @bound
  private _update() {
    if (!this._lastTime) this._lastTime = Date.now();
    const currentTime = Date.now();

    this._elapsed += (currentTime - this._lastTime) * this._speed;
    if (this._elapsed > 100) {
      this._elapsed %= 100;
    }
    this._lastTime = currentTime;

    const interval = (this._updateInterval / 1000) * this._timeScale;

    while (this._elapsed >= this._updateInterval) {
      this.physics.step(interval);
      this._updateMarbles(this._updateInterval);
      this._particleManager.update(this._updateInterval);
      this._updateEffects(this._updateInterval);
      this._elapsed -= this._updateInterval;
      this._uiObjects.forEach((obj) => obj.update(this._updateInterval));
    }

    if (this._marbles.length > 1) {
      this._marbles.sort((a, b) => b.y - a.y);
    }

    if (this._stage) {
      this._camera.update({
        marbles: this._marbles,
        stage: this._stage,
        needToZoom: this._goalDist < zoomThreshold,
        targetIndex:
          this._winningRange > 1 ? 0 : this._winners.length > 0 ? this._winnerRank - this._winners.length : 0,
      });

      if (this._isRunning && this._marbles.length > 0 && this._noMoveDuration > 3000) {
        this._changeShakeAvailable(true);
      } else {
        this._changeShakeAvailable(false);
      }
    }

    this._render();
    window.requestAnimationFrame(this._update);
  }

  private _updateMarbles(deltaTime: number) {
    if (!this._stage) return;

    for (let i = 0; i < this._marbles.length; i++) {
      const marble = this._marbles[i];
      marble.update(deltaTime);
      if (marble.skill === Skills.Impact) {
        this._effects.push(new SkillEffect(marble.x, marble.y));
        this.physics.impact(marble.id);
      }
      if (marble.y > this._stage.goalY) {
        // Check for duplicates only in range mode with the option enabled
        if (this._winningRange > 1 && this._preventDuplicateWinnersInRangeMode) {
          const isDuplicateWinner = this._winners.some((winner) => winner.name === marble.name);
          if (isDuplicateWinner) {
            // Add to duplicate marbles list for tracking
            this._duplicateMarbles.push(marble);
            // Remove the duplicate marble from physics
            setTimeout(() => {
              this.physics.removeMarble(marble.id);
            }, 500);
            continue; // Skip adding this marble to _winners
          }
        }

        this._winners.push(marble);

        // Range 모드: 지정된 범위만큼의 승자가 나오면 게임 종료
        if (this._isRunning && this._winningRange > 1 && this._winners.length === this._winningRange) {
          this.dispatchEvent(
            new CustomEvent('goal', {
              detail: {
                winner: this._winners.map((w) => w.name).join(', '),
                winners: this._winners.map((w) => w.name),
              },
            })
          );
          this._winner = marble; // 마지막 승자를 대표로 설정
          this._isRunning = false;
          this._particleManager.shot(this._renderer.width, this._renderer.height);
          setTimeout(() => {
            this._recorder.stop();
          }, 1000);

          // 무한 반복 모드 처리
          if (this._infiniteLoop) {
            this._scheduleLoop();
          }
        }
        // 기존 단일 승자 모드
        else if (this._isRunning && this._winningRange === 1 && this._winners.length === this._winnerRank + 1) {
          this.dispatchEvent(new CustomEvent('goal', { detail: { winner: marble.name } }));
          this._winner = marble;
          this._isRunning = false;
          this._particleManager.shot(this._renderer.width, this._renderer.height);
          setTimeout(() => {
            this._recorder.stop();
          }, 1000);

          // 무한 반복 모드 처리
          if (this._infiniteLoop) {
            this._scheduleLoop();
          }
        } else if (
          this._isRunning &&
          this._winningRange === 1 &&
          this._winnerRank === this._winners.length &&
          this._winnerRank === this._totalMarbleCount - 1
        ) {
          this.dispatchEvent(
            new CustomEvent('goal', {
              detail: { winner: this._marbles[i + 1].name },
            })
          );
          this._winner = this._marbles[i + 1];
          this._isRunning = false;
          this._particleManager.shot(this._renderer.width, this._renderer.height);
          setTimeout(() => {
            this._recorder.stop();
          }, 1000);

          // 무한 반복 모드 처리
          if (this._infiniteLoop) {
            this._scheduleLoop();
          }
        }
        setTimeout(() => {
          this.physics.removeMarble(marble.id);
        }, 500);
      }
    }

    const targetIndex =
      this._winningRange > 1 ? this._winningRange - this._winners.length - 1 : this._winnerRank - this._winners.length;
    const topY = this._marbles[targetIndex] ? this._marbles[targetIndex].y : 0;
    this._goalDist = Math.abs(this._stage.zoomY - topY);
    this._timeScale = this._calcTimeScale();

    this._marbles = this._marbles.filter((marble) => marble.y <= this._stage!.goalY);
  }

  private _calcTimeScale(): number {
    if (!this._stage) return 1;

    // Range 모드에서는 상위 winningRange 만큼의 구슬이 목표에 가까워질 때 속도 조절
    if (this._winningRange > 1) {
      const targetIndex = this._winningRange - 1;
      if (this._marbles[targetIndex] && this._goalDist < zoomThreshold) {
        const topY = this._marbles[targetIndex].y;
        const goalDist = Math.abs(this._stage.zoomY - topY);
        if (topY > this._stage.zoomY - zoomThreshold * 1.2 && this._marbles[targetIndex - 1]) {
          return Math.max(0.2, goalDist / zoomThreshold);
        }
      }
    } else {
      // 기존 단일 승자 모드
      const targetIndex = this._winnerRank - this._winners.length;
      if (this._winners.length < this._winnerRank + 1 && this._goalDist < zoomThreshold) {
        if (
          this._marbles[targetIndex].y > this._stage.zoomY - zoomThreshold * 1.2 &&
          (this._marbles[targetIndex - 1] || this._marbles[targetIndex + 1])
        ) {
          return Math.max(0.2, this._goalDist / zoomThreshold);
        }
      }
    }
    return 1;
  }

  private _updateEffects(deltaTime: number) {
    this._effects.forEach((effect) => effect.update(deltaTime));
    this._effects = this._effects.filter((effect) => !effect.isDestroy);
  }

  private _render() {
    if (!this._stage) return;
    const renderParams = {
      camera: this._camera,
      stage: this._stage,
      entities: this.physics.getEntities(),
      marbles: this._marbles,
      winners: this._winners,
      duplicateMarbles: this._duplicateMarbles,
      particleManager: this._particleManager,
      effects: this._effects,
      winnerRank: this._winnerRank,
      winningRange: this._winningRange,
      winner: this._winner,
      size: { x: this._renderer.width, y: this._renderer.height },
    };
    this._renderer.render(renderParams, this._uiObjects);
  }

  private async _init() {
    this._recorder = new VideoRecorder(this._renderer.canvas);

    this.physics = new Box2dPhysics();
    await this.physics.init();

    this.addUiObject(new RankRenderer());
    this.attachEvent();
    const minimap = new Minimap();
    minimap.onViewportChange((pos) => {
      if (pos) {
        this._camera.setPosition(pos, false);
        this._camera.lock(true);
      } else {
        this._camera.lock(false);
      }
    });
    this.addUiObject(minimap);
    this._stage = stages[0];
    this._loadMap();
  }

  private attachEvent() {
    this._renderer.canvas.addEventListener('mousemove', (e) => {
      const sizeFactor = this._renderer.sizeFactor;
      const pos = { x: e.offsetX * sizeFactor, y: e.offsetY * sizeFactor };
      this._uiObjects.forEach((obj) => {
        if (!obj.onMouseMove) return;
        const bounds = obj.getBoundingBox();
        if (!bounds) {
          obj.onMouseMove({ ...pos });
        } else if (
          bounds &&
          pos.x >= bounds.x &&
          pos.y >= bounds.y &&
          pos.x <= bounds.x + bounds.w &&
          pos.y <= bounds.y + bounds.h
        ) {
          obj.onMouseMove({ x: pos.x - bounds.x, y: pos.y - bounds.y });
        } else {
          obj.onMouseMove(undefined);
        }
      });
    });
  }

  private _loadMap() {
    if (!this._stage) {
      throw new Error('No map has been selected');
    }

    this.physics.createStage(this._stage);
  }

  public clearMarbles() {
    this.physics.clearMarbles();
    this._winner = null;
    this._winners = [];
    this._duplicateMarbles = [];
    this._marbles = [];
  }

  public start() {
    this._isRunning = true;
    this._winnerRank = options.winningRank;
    this._winningRange = options.winningRange;
    if (this._winnerRank >= this._marbles.length) {
      this._winnerRank = this._marbles.length - 1;
    }

    // 무한 반복 모드일 때 UI 숨김 알림
    if (this._infiniteLoop) {
      this.dispatchEvent(new CustomEvent('hideUI'));
    }

    if (this._autoRecording) {
      this._recorder.start().then(() => {
        this.physics.start();
        this._marbles.forEach((marble) => (marble.isActive = true));
      });
    } else {
      this.physics.start();
      this._marbles.forEach((marble) => (marble.isActive = true));
    }
  }

  public setSpeed(value: number) {
    if (value <= 0) {
      throw new Error('Speed multiplier must larger than 0');
    }
    this._speed = value;
  }

  public getSpeed() {
    return this._speed;
  }

  public setWinningRank(rank: number) {
    this._winnerRank = rank;
  }

  public setWinningRange(range: number) {
    this._winningRange = range;
  }

  public setAutoRecording(value: boolean) {
    this._autoRecording = value;
  }

  public setInfiniteLoop(value: boolean) {
    this._infiniteLoop = value;
    if (!value && this._loopTimeoutId) {
      clearTimeout(this._loopTimeoutId);
      this._loopTimeoutId = null;
    }
  }

  public setLoopDelay(delay: number) {
    this._loopDelay = delay;
  }

  public stopInfiniteLoop() {
    this._infiniteLoop = false;
    if (this._loopTimeoutId) {
      clearTimeout(this._loopTimeoutId);
      this._loopTimeoutId = null;
    }
    // 카운트다운 숨김 및 UI 복원 이벤트 발생
    this.dispatchEvent(new CustomEvent('hideCountdown'));
    this.dispatchEvent(new CustomEvent('showUI'));
  }

  public setMarbles(names: string[]) {
    // 무한 반복을 위해 이름 목록 저장
    this._savedNames = names.slice();

    this.reset();
    const arr = names.slice();

    let maxWeight = -Infinity;
    let minWeight = Infinity;

    const members = arr
      .map((nameString) => {
        const result = parseName(nameString);
        if (!result) return null;
        const { name, weight, count } = result;
        if (weight > maxWeight) maxWeight = weight;
        if (weight < minWeight) minWeight = weight;
        return { name, weight, count };
      })
      .filter((member) => !!member);

    const gap = maxWeight - minWeight;

    let totalCount = 0;
    members.forEach((member) => {
      if (member) {
        member.weight = 0.1 + (gap ? (member.weight - minWeight) / gap : 0);
        totalCount += member.count;
      }
    });

    const orders = Array(totalCount)
      .fill(0)
      .map((_, i) => i)
      .sort(() => Math.random() - 0.5);
    members.forEach((member) => {
      if (member) {
        for (let j = 0; j < member.count; j++) {
          const order = orders.pop() || 0;
          this._marbles.push(new Marble(this.physics, order, totalCount, member.name, member.weight));
        }
      }
    });
    this._totalMarbleCount = totalCount;
  }

  private _clearMap() {
    this.physics.clear();
    this._marbles = [];
  }

  public reset() {
    this.clearMarbles();
    this._clearMap();
    this._loadMap();
    this._goalDist = Infinity;
  }

  public getCount() {
    return this._marbles.length;
  }

  private _changeShakeAvailable(v: boolean) {
    if (this._shakeAvailable !== v) {
      this._shakeAvailable = v;
      this.dispatchEvent(new CustomEvent('shakeAvailableChanged', { detail: v }));
    }
  }

  public shake() {
    if (!this._shakeAvailable) return;
  }

  public getMaps() {
    return stages.map((stage, index) => {
      return {
        index,
        title: stage.title,
      };
    });
  }

  public setMap(index: number) {
    if (index < 0 || index > stages.length - 1) {
      throw new Error('Incorrect map number');
    }
    const names = this._marbles.map((marble) => marble.name);
    this._stage = stages[index];
    this.setMarbles(names);
  }

  private _scheduleLoop() {
    if (this._loopTimeoutId) {
      clearTimeout(this._loopTimeoutId);
    }

    // 카운트다운 시작 이벤트 발생 (게임 결과 포함)
    const delayInSeconds = Math.ceil(this._loopDelay / 1000);
    let winnersInfo: { name: string; rank: number }[] = [];

    if (this._winningRange > 1) {
      // Range 모드: 여러 승자
      winnersInfo = this._winners.map((winner, index) => ({
        name: winner.name,
        rank: index + 1,
      }));
    } else {
      // 단일 승자 모드
      if (this._winner) {
        winnersInfo = [
          {
            name: this._winner.name,
            rank: this._winnerRank + 1,
          },
        ];
      }
    }

    this.dispatchEvent(
      new CustomEvent('startCountdown', {
        detail: {
          seconds: delayInSeconds,
          winners: winnersInfo,
          isMultipleWinners: this._winningRange > 1,
        },
      })
    );

    this._loopTimeoutId = setTimeout(() => {
      this.reset();
      // 저장된 이름 목록으로 다시 구슬 설정 (setMarbles의 로직만 실행)
      if (this._savedNames.length > 0) {
        const arr = this._savedNames.slice();

        let maxWeight = -Infinity;
        let minWeight = Infinity;

        const members = arr
          .map((nameString) => {
            const result = parseName(nameString);
            if (!result) return null;
            const { name, weight, count } = result;
            if (weight > maxWeight) maxWeight = weight;
            if (weight < minWeight) minWeight = weight;
            return { name, weight, count };
          })
          .filter((member) => !!member);

        const gap = maxWeight - minWeight;

        let totalCount = 0;
        members.forEach((member) => {
          if (member) {
            member.weight = 0.1 + (gap ? (member.weight - minWeight) / gap : 0);
            totalCount += member.count;
          }
        });

        const orders = Array(totalCount)
          .fill(0)
          .map((_, i) => i)
          .sort(() => Math.random() - 0.5);
        members.forEach((member) => {
          if (member) {
            for (let j = 0; j < member.count; j++) {
              const order = orders.pop() || 0;
              this._marbles.push(new Marble(this.physics, order, totalCount, member.name, member.weight));
            }
          }
        });
        this._totalMarbleCount = totalCount;
      }

      this.start();
    }, this._loopDelay);
  }

  public setPreventDuplicateWinnersInRangeMode(value: boolean) {
    this._preventDuplicateWinnersInRangeMode = value;
  }
}
