/** In-memory wallet stub. Real money integration is out of scope for v1 (FSD §8). */
export class Wallet {
  private cents: number;

  constructor(startingBalanceCents: number) {
    this.cents = startingBalanceCents;
  }

  get balanceCents(): number {
    return this.cents;
  }

  debit(amountCents: number): void {
    if (amountCents > this.cents) {
      throw new Error("insufficient funds");
    }
    this.cents -= amountCents;
  }

  credit(amountCents: number): void {
    this.cents += amountCents;
  }
}
