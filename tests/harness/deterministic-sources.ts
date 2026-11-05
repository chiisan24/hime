type Instant = Date | number | string;

function toEpochMilliseconds(instant: Instant): number {
  const milliseconds = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("FakeClock requires a valid instant");
  }

  return milliseconds;
}

export class FakeClock {
  #milliseconds: number;

  public constructor(initialInstant: Instant) {
    this.#milliseconds = toEpochMilliseconds(initialInstant);
  }

  public now(): Date {
    return new Date(this.#milliseconds);
  }

  public set(instant: Instant): void {
    this.#milliseconds = toEpochMilliseconds(instant);
  }

  public advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("FakeClock advance must be a finite non-negative number");
    }

    this.#milliseconds += milliseconds;
  }
}

export class FakeIdSource {
  #nextValue: number;
  readonly #prefix: string;

  public constructor(prefix = "test-id", seed = 0) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(prefix)) {
      throw new TypeError("FakeIdSource prefix must be a non-empty identifier");
    }
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new RangeError("FakeIdSource seed must be a non-negative safe integer");
    }

    this.#prefix = prefix;
    this.#nextValue = seed;
  }

  public nextId(): string {
    if (!Number.isSafeInteger(this.#nextValue)) {
      throw new RangeError("FakeIdSource exhausted the safe integer range");
    }

    const id = `${this.#prefix}-${this.#nextValue.toString().padStart(6, "0")}`;
    this.#nextValue += 1;
    return id;
  }
}
