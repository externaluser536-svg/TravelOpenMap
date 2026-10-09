// Сглаживание GPS. Раньше любой фикс хуже заданной точности просто отбрасывался, и при слабом сигнале
// (город, лес, помещение) ничего не записывалось. Теперь последовательные неточные фиксы усредняются
// простым фильтром Калмана: каждый вес пропорционален обратной дисперсии (accuracy²), а неопределённость
// растёт со временем и скоростью. Несколько согласованных слабых точек подряд дают достаточно надёжное положение.

export interface RawFix {
  lng: number;
  lat: number;
  accuracy?: number;
  speed?: number | null;
  t: number;
}

export interface Smoothed {
  lng: number;
  lat: number;
  /** оценка погрешности после сглаживания, м */
  accuracy: number;
}

/** Фиксы хуже этого порога (например, по сети, а не по спутникам) в сглаживание не берём: они только сбивают оценку. */
export const HOPELESS_ACCURACY = 500;
/** Минимальная скорость «разлёта» неопределённости, м/с (пешая ходьба и дрожание). */
const MIN_PROCESS_SPEED = 6;
/** Фиксы не хуже этого порога точны сами по себе: проходят без сглаживания (оно только запаздывало бы), но обновляют оценку. */
export const GOOD_ACCURACY = 15;
/** Точка дальше этого числа сигм от оценки — не шум, а реальное перемещение. */
const GATE_SIGMAS = 3.5;
/** Пауза дольше этой — оценка устарела, начинаем заново, с. */
const RESET_AFTER_S = 90;
/** Сглаживание не может обещать погрешность лучше половины погрешности самого фикса: ошибки соседних точек связаны. */
const MAX_GAIN = 0.5;

export class GpsFilter {
  private lng = 0;
  private lat = 0;
  private variance = -1;
  private t = 0;

  reset(): void {
    this.variance = -1;
  }

  /** Фикс без указанной точности (например, эмуляция) проходит как есть; слишком неточный — тоже, но не влияет на оценку. */
  update(f: RawFix): Smoothed {
    const raw = f.accuracy;
    if (raw === undefined) {
      this.reset();
      return { lng: f.lng, lat: f.lat, accuracy: 0 };
    }
    if (raw > HOPELESS_ACCURACY) return { lng: f.lng, lat: f.lat, accuracy: raw };
    const acc = Math.max(raw, 1);
    const dt = (f.t - this.t) / 1000;
    if (this.variance < 0 || dt > RESET_AFTER_S || dt < -5 || acc <= GOOD_ACCURACY) {
      this.lng = f.lng;
      this.lat = f.lat;
      this.variance = acc * acc;
      this.t = f.t;
      return { lng: f.lng, lat: f.lat, accuracy: acc };
    }
    if (dt > 0) {
      const q = Math.max(MIN_PROCESS_SPEED, (f.speed ?? 0) * 2);
      this.variance += dt * q * q;
      this.t = f.t;
    }
    // настоящий скачок (самолёт, возврат сигнала после паузы): точка слишком далека от оценки, чтобы быть шумом — принимаем её как есть
    const dy = (f.lat - this.lat) * 110_574;
    const dx = (f.lng - this.lng) * 111_320 * Math.cos((f.lat * Math.PI) / 180);
    if (Math.hypot(dx, dy) > GATE_SIGMAS * Math.sqrt(this.variance + acc * acc)) {
      this.lng = f.lng;
      this.lat = f.lat;
      this.variance = acc * acc;
      return { lng: f.lng, lat: f.lat, accuracy: acc };
    }
    const k = this.variance / (this.variance + acc * acc);
    this.lng += k * (f.lng - this.lng);
    this.lat += k * (f.lat - this.lat);
    this.variance = (1 - k) * this.variance;
    return { lng: this.lng, lat: this.lat, accuracy: Math.max(Math.sqrt(this.variance), acc * MAX_GAIN) };
  }
}
