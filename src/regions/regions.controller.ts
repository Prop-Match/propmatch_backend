import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateCityDto } from './dto/create-city.dto';
import { CreateCountryDto } from './dto/create-country.dto';
import { CreateGovernorateDto } from './dto/create-governorate.dto';
import { CreateDistrictDto } from './dto/create-district.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { RegionsService } from './regions.service';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Controller('regions')
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Get('active')
  getActive() {
    return this.regionsService.getActiveRegions();
  }

  @Get()
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  getRegions() {
    return this.regionsService.getAllRegions();
  }

  @Patch('countries/:id/status')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async toggleCountryStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.regionsService.toggleCountryStatus(id, dto.status);
  }

  @Patch('governorates/:id/status')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async toggleGovernorateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.regionsService.toggleGovernorateStatus(id, dto.status);
  }

  @Patch('cities/:id/status')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async toggleCityStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.regionsService.toggleCityStatus(id, dto.status);
  }

  @Patch('districts/:id/status')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async toggleDistrictStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.regionsService.toggleDistrictStatus(id, dto.status);
  }

  @Post('countries')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: (diskStorage as any)({
        destination: (_req, _file, cb) => {
          const dest = './public/flags';
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          cb(null, dest);
        },
        filename: (
          _req: any,
          file: { originalname: string },
          cb: (arg0: null, arg1: string) => void,
        ) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: {
        fileSize: MAX_FILE_SIZE,
      },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          return cb(new BadRequestException('نوع الصورة غير مدعوم.'), false);
        }
        cb(null, true);
      },
    }),
  )
  createCountry(
    @Body() dto: CreateCountryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('صورة العلم مطلوبة');
    }
    console.log(file);

    const imageUrl = `/public/flags/${file.filename}`;
    console.log('Image url -------->>', imageUrl);

    return this.regionsService.createCountry({ ...dto, image: imageUrl });
  }

  @Post('governorates')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  createGovernorate(@Body() dto: CreateGovernorateDto) {
    return this.regionsService.createGovernorate(dto);
  }

  @Post('cities')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  createCity(@Body() dto: CreateCityDto) {
    return this.regionsService.createCity(dto);
  }

  @Post('districts')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  createDistrict(@Body() dto: CreateDistrictDto) {
    return this.regionsService.createDistrict(dto);
  }
}
