import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';
import { VerificationController } from '../../verification/verification.controller';
import {
  LeaseContractByIdController,
  LeaseContractsController,
} from '../../lease-contracts/lease-contracts.controller';
import { CustomerSupportController } from '../../customer-support/customer-support.controller';
import { MessagesController } from '../../messages/messages.controller';

const userRoles = ['TENANT', 'LANDLORD'];

describe('role boundary metadata', () => {
  it.each([
    VerificationController,
    LeaseContractsController,
    LeaseContractByIdController,
  ])('%s is guarded and excludes admins', (controller) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(
      RolesGuard,
    );
    expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual(userRoles);
  });

  it.each([
    'createTicket',
    'streamAiChat',
    'getMyTickets',
    'getTicketDetail',
    'userReply',
  ] as const)(
    'restricts customer support method %s to user roles',
    (method) => {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          CustomerSupportController.prototype[method],
        ),
      ).toEqual(userRoles);
    },
  );

  it('runs RolesGuard for customer support role metadata', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CustomerSupportController),
    ).toContain(RolesGuard);
  });

  it('allows user roles to reach the direction-aware agreement confirmation', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        // Metadata is attached to the method function itself.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        MessagesController.prototype.confirmAgreement,
      ),
    ).toEqual(['TENANT', 'LANDLORD']);
  });
});
