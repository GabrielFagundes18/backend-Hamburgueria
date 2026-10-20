/** Erro de regra de negócio: vira resposta 400 com a mensagem para o cliente. */
export class CheckoutError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
