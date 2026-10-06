import { Injectable } from '@angular/core';

export interface AvatarOption {
  id: string;
  style: string;
  label: string;
  url: string;
}

@Injectable({ providedIn: 'root' })
export class AvatarService {
  private readonly styles = ['adventurer', 'avataaars', 'bottts', 'croodles', 'identicon', 'pixel-art'];

  defaultAvatar(seed: string): string {
    return this.avatarUrl('bottts', seed || 'smartshare');
  }

  options(seed: string): AvatarOption[] {
    const cleanSeed = seed || 'smartshare';
    return this.styles.map(style => ({
      id: `${style}-${cleanSeed}`,
      style,
      label: style.replace('-', ' '),
      url: this.avatarUrl(style, cleanSeed),
    }));
  }

  avatarUrl(style: string, seed: string): string {
    return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=0f172a,1e293b,312e81`;
  }
}