import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Tip } from '../model/tip.model';
import { TipAudience } from '../model/tipaudience.model';
import * as moment from 'moment';
import { TemporaryAppManagerPlugin } from 'src/app/TMP_STUBS';
import { NotificationManagerService } from './notificationmanager.service';
import { GlobalStorageService } from 'src/app/services/global.storage.service';
import { GlobalPreferencesService } from 'src/app/services/global.preferences.service';
import { DIDSessionsService } from 'src/app/services/didsessions.service';

const DURATION_MIN_BETWEEN_2_TIPS_MS = 12 * 60 * 60 * 1000; // 12 hours
const DURATION_BETWEEN_2_CHECKS_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Service responsible for rotating tips displayed to users as notifications,
 * in order to better understand elastOS.
 */
@Injectable({
  providedIn: 'root'
})
export class TipsService {
  // NOTE: The following tips are displayed in the same order they are in the list below:
  private tips: Tip[] = [
    {
      title: "tip-title-welcome",
      message: "tip-message-welcome",
      audience: TipAudience.FOR_ELASTOS_TRINITY_GENERIC
    },
    {
      title: "tip-title-dev-getting-support",
      message: "tip-message-dev-getting-support",
      audience: TipAudience.FOR_ELASTOS_TRINITY_DEVELOPERS
    },
    {
      title: "tip-title-what-is-did",
      message: "tip-message-what-is-did",
      audience: TipAudience.FOR_ELASTOS_TRINITY_GENERIC
    },
    {
      title: "tip-title-what-is-hive",
      message: "tip-message-what-is-hive",
      audience: TipAudience.FOR_ELASTOS_TRINITY_GENERIC
    },
    {
      title: "tip-title-dev-wipe-data",
      message: "tip-message-dev-wipe-data",
      audience: TipAudience.FOR_ELASTOS_TRINITY_DEVELOPERS
    },
    {
      title: "tip-title-toolbox",
      message: "tip-message-toolbox",
      audience: TipAudience.FOR_ELASTOS_TRINITY_GENERIC
    },
    {
      title: "tip-title-not-only-for-crypto-players",
      message: "tip-message-not-only-for-crypto-players",
      audience: TipAudience.FOR_ELASTOS_TRINITY_GENERIC
    },
    {
      title: "tip-title-dev-trinity-native",
      message: "tip-message-dev-trinity-native",
      audience: TipAudience.FOR_ELASTOS_TRINITY_DEVELOPERS
    },
    {
      title: "tip-title-capsule-marketplace",
      message: "tip-message-capsule-marketplace",
      audience: TipAudience.FOR_ELASTOS_TRINITY_GENERIC
    },
    {
      title: "tip-title-bring-friends",
      message: "tip-message-bring-friends",
      audience: TipAudience.FOR_ELASTOS_TRINITY_GENERIC
    },
  ]

  constructor(
    private translate: TranslateService,
    private appManager: TemporaryAppManagerPlugin,
    private storage: GlobalStorageService,
    private prefs: GlobalPreferencesService,
    private notificationManager: NotificationManagerService,
    private didSessions: DIDSessionsService) { }

  public async init() {
    console.log("Tips service is initializing");

    await this.resetAllTipsAsNotViewed(); // DEBUG ONLY

    // Wait a moment while the launcher starts, then start showing tips if needed.
    setTimeout(() => {
      this.checkIfTimeToShowATip();
    }, 1000);
  }

  private async checkIfTimeToShowATip() {
    console.log("Checking if it's a right time to show a tip");

    if (!await this.userWantsToSeeTips()) {
      console.log("User doesn't want to see tips. Skipping.");
      return;
    }

    if (await this.rightTimeToShowATip()) {
      this.showNextTip();
    }

    // No matter what, check again in X minutes
    setTimeout(() => {
      this.checkIfTimeToShowATip();
    }, DURATION_BETWEEN_2_CHECKS_MS);
  }

  // Find the suitable tip to show next, and show it.
  private async showNextTip() {
    console.log("All tips:", this.tips);

    // Load tips that user has already viewed
    let viewedTips = await this.loadViewedTips();
    console.log("Viewed tips:", viewedTips);

    // Exclude developer tips if user is not a developer, etc.
    let usableTips = await this.getAllTipsUserCanView();

    // Exclude viewed tips from the whole list of tips
    usableTips = this.tips.filter((tip) => {
      return viewedTips.find((t) => {
        return t.title == tip.title;
      }) == null;
    });

    console.log("Usable tips:", usableTips);

    // Take the first usable tip of the list, if any.
    if (usableTips.length > 0) {
      let tipToNotify = usableTips[0];

      // In order to be able to pass more advanced data, we send the message as a JSON string that is
      // parsed by the notification manager.
      let jsonMessage = {
        type: "tip",
        key: tipToNotify.title,
        message: this.translate.instant(tipToNotify.message)
      }

      this.notificationManager.sendNotification({
        key: "launcher_tip_of_the_day", // Always overwrite previous tip notifications, if any
        title: this.translate.instant(tipToNotify.title),
        message: JSON.stringify(jsonMessage)
      });

      // Save current time, so we can know when to show another tip next.
      await this.saveSentTipTime();
    }
  }

  private async rightTimeToShowATip(): Promise<boolean> {
    return new Promise(async (resolve) => {
      try {
        let value = await this.storage.getSetting<string>(DIDSessionsService.signedInDIDString, "launcher", "latest-sent-tip-time", null);
        // value must be a ISO string
        let latestSentTipTime = moment(value);

        // Right time to show if last time we have shown a tip was more than X hours ago.
        resolve(latestSentTipTime.add(DURATION_MIN_BETWEEN_2_TIPS_MS, "hours").isBefore(moment()));
        //resolve(true);
      }
      catch (err) {
        console.error("rightTimeToShowATip() error:", err);
        resolve(true);
      }
    });
  }

  private async saveSentTipTime() {
    return new Promise(async (resolve) => {
      try {
        await this.storage.setSetting(DIDSessionsService.signedInDIDString, "launcher", "latest-sent-tip-time", new Date().toISOString());
        resolve();
      }
      catch (err) {
        // Kind of blocking issue, but let's resolve anyway...
        console.error("saveSentTipTime() error:", err);
        resolve();
      }
    });
  }

  /**
   * Returns the list of all tips the current user is entitled to view. For example a non developer
   * should never see any developer tip.
   */
  public async getAllTipsUserCanView(): Promise<Tip[]> {
    let isDeveloperModeEnabled = await this.developerModeEnabled();

    let tipsThatCanBeViewed = this.tips;
    if (!isDeveloperModeEnabled) {
      tipsThatCanBeViewed = tipsThatCanBeViewed.filter((tip) => {
        return tip.audience != TipAudience.FOR_ELASTOS_TRINITY_DEVELOPERS;
      });
    }

    return tipsThatCanBeViewed;
  }

  private userWantsToSeeTips(): Promise<boolean> {
    return new Promise(async (resolve) => {
      try {
        let value = await this.prefs.getPreference<boolean>(DIDSessionsService.signedInDIDString, "help.dailytips.show");
        resolve(value);
      }
      catch (err) {
        // Preference does not exist - Consider this as a yes
        resolve(true);
      }
    });
  }

  public async markTipAsViewed(tip: Tip) {
    let viewedTips = await this.loadViewedTips();
    viewedTips.push(tip);

    await this.saveViewedTips(viewedTips);
  }

  /**
   * Forbids all tips read by user and restarts the tips scheduling from 0 as if this was a new user.
   */
  public async resetAllTipsAsNotViewed(): Promise<void> {
    await this.saveViewedTips([]);
  }

  public findTipByIdentifier(identifier: string): Tip {
    return this.tips.find((tip) => {
      return tip.title == identifier;
    });
  }

  private async saveViewedTips(tips: Tip[]) {
    return new Promise(async (resolve) => {
      await this.storage.setSetting(DIDSessionsService.signedInDIDString, "launcher", "viewed-tips", tips);
      resolve();
    });
  }

  private loadViewedTips(): Promise<Tip[]> {
    return new Promise(async (resolve) => {
      try {
        let tips = await this.storage.getSetting<Tip[]>(DIDSessionsService.signedInDIDString, "launcher", "viewed-tips", []);
        resolve(tips);
      }
      catch (err) {
        resolve([]);
      }
    });
  }

  private developerModeEnabled(): Promise<boolean> {
    return new Promise(async (resolve) => {
      try {
        let devMode = await this.prefs.getPreference(DIDSessionsService.signedInDIDString, "developer.mode");
        if (devMode)
          resolve(true);
        else
          resolve(false);
      }
      catch (err) {
        console.warn("developerModeEnabled() error", err);
        resolve(false);
      }
    });
  }
}
