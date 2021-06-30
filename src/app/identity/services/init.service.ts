import { Injectable } from '@angular/core';
import { UXService } from './ux.service';
import { BackgroundService } from './background.service';
import { IntentReceiverService } from './intentreceiver.service';
import { TranslationService } from './translation.service';
import { DIDEvents } from './events';
import { ProfileService } from './profile.service';
import { DIDSyncService } from './didsync.service';

@Injectable({
  providedIn: 'root'
})
export class IdentityInitService {
  constructor(
    private uxService: UXService,
    private backgroundService: BackgroundService,
    public didEvents: DIDEvents,
    private didSyncService: DIDSyncService,
    private profileService: ProfileService,
    private intentReceiverService: IntentReceiverService,
    public translationService: TranslationService // Don't delete, static instance initialized
  ) {}

  public async init(): Promise<void> {
    await this.backgroundService.init();
    await this.didSyncService.init();
    await this.profileService.init();
    await this.uxService.init();
    await this.intentReceiverService.init();
  }

  public start() {
    void this.uxService.computeAndShowEntryScreen();
  }
}
