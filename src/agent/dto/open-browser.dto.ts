import { IsOptional, IsUrl } from 'class-validator';

export class OpenBrowserDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;
}
