import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UsersService.deleteAccount', () => {
  const $transaction = jest.fn();
  const userUpdate = jest.fn();
  const tenantRequestUpdateMany = jest.fn();
  const propertyUpdateMany = jest.fn();
  const userDelete = jest.fn();

  const service = new UsersService({
    user: { update: userUpdate, delete: userDelete },
    tenantRequest: { updateMany: tenantRequestUpdateMany },
    property: { updateMany: propertyUpdateMany },
    $transaction,
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    userUpdate.mockReturnValue({});
    tenantRequestUpdateMany.mockReturnValue({});
    propertyUpdateMany.mockReturnValue({});
    $transaction.mockResolvedValue([]);
  });

  it('soft-deletes via a single transaction instead of a hard delete', async () => {
    await service.deleteAccount('user-1');

    expect($transaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ]),
    );
    expect(userDelete).not.toHaveBeenCalled();
  });

  it('sets deletedAt and bumps tokenVersion', () => {
    void service.deleteAccount('user-1');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        deletedAt: expect.any(Date), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        tokenVersion: { increment: 1 },
      },
    });
  });

  it('archives the user’s own tenant requests and properties', () => {
    void service.deleteAccount('user-1');

    expect(tenantRequestUpdateMany).toHaveBeenCalledWith({
      where: { tenantId: 'user-1', status: { notIn: ['ARCHIVED'] } },
      data: { status: 'ARCHIVED' },
    });
    expect(propertyUpdateMany).toHaveBeenCalledWith({
      where: { ownerId: 'user-1', status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED' },
    });
  });
});
