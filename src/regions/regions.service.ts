import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './../../prisma/prisma.service';
import { CreateCityDto } from './dto/create-city.dto';
import { CreateCountryDto } from './dto/create-country.dto';
import { CreateDistrictDto } from './dto/create-district.dto';
import { CreateGovernorateDto } from './dto/create-governorate.dto';

@Injectable()
export class RegionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getAllRegions() {
    return this.prismaService.country.findMany({
      include: {
        governorates: {
          orderBy: { id: 'asc' },
          include: {
            cities: {
              orderBy: { id: 'asc' },
              include: {
                districts: {
                  orderBy: { id: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
    });
  }
  async toggleCountryStatus(id: number, status: boolean) {
    return this.prismaService.country.update({
      where: { id },
      data: { status },
    });
  }
  async toggleGovernorateStatus(id: number, status: boolean) {
    return this.prismaService.governorate.update({
      where: { id },
      data: { status },
    });
  }
  async toggleCityStatus(id: number, status: boolean) {
    return this.prismaService.city.update({
      where: { id },
      data: { status },
    });
  }
  async toggleDistrictStatus(id: number, status: boolean) {
    return this.prismaService.district.update({
      where: { id },
      data: { status },
    });
  }
  async createCountry(dto: CreateCountryDto) {
    if (!dto.image) {
      throw new BadRequestException('صورة العلم مطلوبة');
    }
    return this.prismaService.country.create({
      data: {
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        code: dto.code,
        image: dto.image,
      },
    });
  }
  async createGovernorate(dto: CreateGovernorateDto) {
    return this.prismaService.governorate.create({ data: dto });
  }
  async createCity(dto: CreateCityDto) {
    return this.prismaService.city.create({ data: dto });
  }
  async createDistrict(dto: CreateDistrictDto) {
    return this.prismaService.district.create({ data: dto });
  }
  async getActiveRegions() {
    return this.prismaService.country.findMany({
      where: { status: true },
      include: {
        governorates: {
          where: { status: true },
          orderBy: { id: 'asc' },
          include: {
            cities: {
              where: { status: true },
              orderBy: { id: 'asc' },
              include: {
                districts: {
                  where: { status: true },
                  orderBy: { id: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }
}
