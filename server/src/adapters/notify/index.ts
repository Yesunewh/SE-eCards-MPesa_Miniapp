/** Sends emails and SMS. 'log' records messages in memory and the console; add an SMS gateway / SMTP adapter here. */
export interface OutboundMessage { channel: 'email' | 'sms'; to: string; subject?: string; text: string }

export interface Notifier {
  readonly name: string;
  send(m: OutboundMessage): Promise<{ messageId: string }>;
}

export class LogNotifier implements Notifier {
  readonly name = 'log';
  readonly sent: OutboundMessage[] = [];
  constructor(private readonly quiet = false) {}
  async send(m: OutboundMessage) {
    this.sent.push(m);
    if (!this.quiet) console.log(`[notify:${m.channel}] to ${m.to}: ${m.subject ?? ''} (${m.text.length} chars)`);
    return { messageId: `log-${this.sent.length}` };
  }
}
