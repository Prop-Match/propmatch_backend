import { Injectable } from '@nestjs/common';
import { Prisma, User } from 'generated/prisma/client';
import { PrismaService } from './../../prisma/prisma.service';

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
      where: { email },
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

  async deleteAccount(id: string): Promise<void> {
    await this.prisma.userQuota.deleteMany({ where: { userId: id } });
    await this.prisma.user.delete({ where: { id } });
  }
}
