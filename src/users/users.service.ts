import { Injectable } from '@nestjs/common';
import { Prisma, User } from 'generated/prisma/client';
import { PrismaService } from './../../prisma/prisma.service';
import { normalizeEmail } from '../auth/email';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}
  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        identityVerification: true,
      },
    });
  }
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      include: { identityVerification: true },
    });
  }
  // findAll() {
  //   return `This action returns all users`;
  // }

  async updateProfile(
    id: string,
    data: {
      fullName?: string;
      phoneNumber?: string;
      avatarUrl?: string | null;
    },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
      include: { identityVerification: true },
    });
  }

  /**
   * Self-service account deletion. Soft-delete, same as
   * AdminService.softDeleteUser — NOT a hard `user.delete()`. Most relations
   * to User use Prisma's default onDelete: Restrict, so a hard delete throws
   * a foreign-key violation for any account that ever sent a message, made
   * an offer, left a review, etc. (i.e. every real account), which is what
   * was 500ing this endpoint. Sets deletedAt, archives the user's own
   * TenantRequests/Properties, and bumps tokenVersion so any token minted
   * before the delete stops working immediately (JwtStrategy/gateway both
   * check this).
   */
  async deleteAccount(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), tokenVersion: { increment: 1 } },
      }),
      this.prisma.tenantRequest.updateMany({
        where: { tenantId: id, status: { notIn: ['ARCHIVED'] } },
        data: { status: 'ARCHIVED' },
      }),
      this.prisma.property.updateMany({
        where: { ownerId: id, status: { not: 'ARCHIVED' } },
        data: { status: 'ARCHIVED' },
      }),
    ]);
  }
}
