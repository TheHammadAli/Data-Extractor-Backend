import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class StartRunDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  @IsNotEmpty()
  instructions!: string;
}
