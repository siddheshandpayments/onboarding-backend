import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { EntitlementsService } from './entitlements.service';
import { CreateEntitlementDto } from './dto/create-entitlement.dto';
import { parsePagination } from '../common/list-query.util';

@Controller('entitlements')
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  // Only SuperAdmin/HR define entitlements (BRD: "Admin ... only role
  // that edits templates and entitlements").
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateEntitlementDto) {
    return this.entitlementsService.createEntitlement(dto, actor.id);
  }

  // Any authenticated user sees what's available to them — scoped
  // server-side to their own department, see EntitlementsService. Step
  // 33: limit/offset pagination.
  @UseGuards(JwtAuthGuard)
  @Get()
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.entitlementsService.listVisibleForActor(user, parsePagination({ limit, offset }));
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/claim')
  claim(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.entitlementsService.claimEntitlement(id, user);
  }
}
