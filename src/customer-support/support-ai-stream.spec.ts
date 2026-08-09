import { SupportPriority } from '@generated/prisma/enums';
import {
  ESCALATION_FAILURE_MESSAGE,
  ESCALATION_SUCCESS_MESSAGE,
  parseSsePayload,
  transformSupportSseFrame,
} from './support-ai-stream';

const escalationFrame = `data: ${JSON.stringify({
  type: 'done',
  id: 'message-1',
  escalated: true,
  escalationReason: 'طلب دعم بشري',
  priority: SupportPriority.HIGH,
})}`;

describe('transformSupportSseFrame', () => {
  it('reports success only after the ticket has been persisted', async () => {
    const createEscalation = jest
      .fn()
      .mockResolvedValue({ ticketId: 'ticket-1' });

    const output = await transformSupportSseFrame(
      escalationFrame,
      createEscalation,
    );

    expect(createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ priority: SupportPriority.HIGH }),
    );
    expect(parseSsePayload(output[0])).toEqual({
      type: 'token',
      value: ESCALATION_SUCCESS_MESSAGE,
    });
    expect(parseSsePayload(output[1])).toEqual(
      expect.objectContaining({ escalated: true, ticketId: 'ticket-1' }),
    );
  });

  it('returns a truthful fallback when persistence fails', async () => {
    const output = await transformSupportSseFrame(escalationFrame, async () => {
      throw new Error('database unavailable');
    });

    expect(parseSsePayload(output[0])).toEqual({
      type: 'token',
      value: ESCALATION_FAILURE_MESSAGE,
    });
    expect(parseSsePayload(output[1])).toEqual(
      expect.objectContaining({ escalated: false }),
    );
    expect(parseSsePayload(output[1])).not.toHaveProperty('ticketId');
    expect(parseSsePayload(output[1])).not.toHaveProperty('escalationReason');
  });

  it('passes normal token frames through unchanged', async () => {
    const frame = 'data: {"type":"token","value":"answer"}';
    const createEscalation = jest.fn();

    await expect(
      transformSupportSseFrame(frame, createEscalation),
    ).resolves.toEqual([`${frame}\n\n`]);
    expect(createEscalation).not.toHaveBeenCalled();
  });
});
