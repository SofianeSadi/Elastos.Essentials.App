import { HttpClient } from "@angular/common/http";
import { Component, NgZone, OnInit, ViewChild } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { ActionSheetController } from "@ionic/angular";
import { TranslateService } from "@ngx-translate/core";
import { isNil } from "lodash-es";
import * as moment from "moment";
import { Subscription } from "rxjs";
import { TitleBarComponent } from "src/app/components/titlebar/titlebar.component";
import { TitleBarIcon, TitleBarMenuItem } from "src/app/components/titlebar/titlebar.types";
import { transparentPixelIconDataUrl } from "src/app/helpers/picture.helpers";
import { AuthService } from "src/app/identity/services/auth.service";
import { Logger } from "src/app/logger";
import { Events } from "src/app/services/events.service";
import { GlobalIntentService } from "src/app/services/global.intent.service";
import { GlobalNativeService } from "src/app/services/global.native.service";
import { GlobalNavService } from "src/app/services/global.nav.service";
import { GlobalPopupService } from "src/app/services/global.popup.service";
import { GlobalThemeService } from "src/app/services/global.theme.service";
import { DIDDocument } from "../../model/diddocument.model";
import { VerifiableCredential } from "../../model/verifiablecredential.model";
import { BasicCredentialsService } from '../../services/basiccredentials.service';
import { CredentialsService } from "../../services/credentials.service";
import { DIDService } from "../../services/did.service";
import { DIDSyncService } from "../../services/didsync.service";
import { ProfileService } from "../../services/profile.service";

type IssuerDisplayEntry = {
  did: string;
  name: string;
  avatar: string;
};

type DisplayProperty = {
  name: string;
  value: string;
};

@Component({
  selector: "credentialdetails-profile",
  templateUrl: "credentialdetails.page.html",
  styleUrls: ["credentialdetails.page.scss"],
})
export class CredentialDetailsPage implements OnInit {
  @ViewChild(TitleBarComponent, { static: false }) titleBar: TitleBarComponent;

  public credentials: VerifiableCredential[];
  public currentOnChainDIDDocument: DIDDocument = null;
  public credential: VerifiableCredential;
  public issuer: IssuerDisplayEntry;
  private avatarImg = null;
  public isCredentialInLocalDIDDocument = false;
  public isCredentialInPublishedDIDDocument = false;
  public hasCheckedCredential = false;
  public updatingVisibility = false; // The local document is being updated to add or remove this credential

  public segment = "validator";
  public credentialId: string = null;
  public appIcon: string;
  public iconSrc = transparentPixelIconDataUrl(); // Main icon html src data


  private didchangedSubscription: Subscription = null;
  private publicationstatusSubscription: Subscription = null;
  private documentChangedSubscription: Subscription = null;
  private credentialaddedSubscription: Subscription = null;
  private onlineDIDDocumentStatusSub: Subscription = null;

  public displayableProperties: DisplayProperty[];

  private titleBarIconClickedListener: (icon: TitleBarIcon | TitleBarMenuItem) => void;

  constructor(
    private http: HttpClient,
    public events: Events,
    public route: ActivatedRoute,
    private router: Router,
    public zone: NgZone,
    private translate: TranslateService,
    private didService: DIDService,
    private didSyncService: DIDSyncService,
    public theme: GlobalThemeService,
    public actionSheetController: ActionSheetController,
    public profileService: ProfileService,
    private basicCredentialService: BasicCredentialsService,
    private globalIntentService: GlobalIntentService,
    private globalPopupService: GlobalPopupService,
    private globalNavService: GlobalNavService,
    private globalNativeService: GlobalNativeService,
    private authService: AuthService,
    private credentialsService: CredentialsService
  ) {
    this.init();
  }

  ngOnInit() {
    const navigation = this.router.getCurrentNavigation();
    if (navigation.extras.state.credentialId) {
      this.credentialId = navigation.extras.state.credentialId;

      let didString = this.didService.getActiveDid().getDIDString();
      this.onlineDIDDocumentStatusSub = this.didSyncService.onlineDIDDocumentsStatus.get(didString).subscribe((document) => {
        void this.prepareCredential();
      });
    }

    this.didchangedSubscription = this.events.subscribe("did:didchanged", () => {
      this.zone.run(() => {
        this.init();
      });
    });

    this.documentChangedSubscription = this.events.subscribe("diddocument:changed", (publishAvatar: boolean) => {
      Logger.log('Identity', "Publish avatar?", publishAvatar);
      // When the did document content changes, we rebuild our profile entries on screen.
      this.init(publishAvatar);
    });

    this.credentialaddedSubscription = this.events.subscribe("did:credentialadded", () => {
      this.zone.run(() => {
        this.init();
      });
    });
  }

  unsubscribe(subscription: Subscription) {
    if (subscription) {
      subscription.unsubscribe();
    }
  }

  ngOnDestroy() {
    this.unsubscribe(this.didchangedSubscription);
    this.unsubscribe(this.publicationstatusSubscription);
    this.unsubscribe(this.documentChangedSubscription);
    this.unsubscribe(this.credentialaddedSubscription);
    this.unsubscribe(this.onlineDIDDocumentStatusSub);
  }

  init(publishAvatar?: boolean) {
    let identity = this.didService.getActiveDid();
    if (identity) {
      this.credentials = identity.credentials;

      this.profileService.getAvatarDataUrl().subscribe(avatarDataUrl => {
        this.avatarImg = avatarDataUrl;
      });
    }
  }

  async ionViewWillEnter() {
    await this.getIssuer();
    this.displayableProperties = this.getDisplayableProperties();
    this.titleBar.setTitle(this.translate.instant('identity.credentialdetails-title'));
    this.titleBar.setupMenuItems([
      { key: "delete", title: this.translate.instant('common.delete'), iconPath: "assets/contacts/images/delete.svg" }
    ]);
    this.titleBar.setMenuVisibility(true);

    this.titleBar.addOnItemClickedListener(this.titleBarIconClickedListener = (icon) => {
      if (icon.key === "delete") {
        void this.deleteCredential();
      }
    });
  }

  ionViewWillLeave() {
    this.titleBar.removeOnItemClickedListener(this.titleBarIconClickedListener);
  }

  ionViewDidEnter() {
    let identity = this.didService.getActiveDid();
    this.profileService.didString = identity.getDIDString();

    Logger.log('Identity',
      "Credential details ionViewDidEnter did: " + this.profileService.didString
    );

    /* if (this.isApp()) {
      this.getAppIcon();
    } */
  }

  async prepareCredential() {
    Logger.log("identity", "Computing credential status");

    this.credential = null;
    this.issuer = null;
    this.segment = "validator";

    if (isNil(this.credentialId) || isNil(this.credentials) || this.credentials.length <= 0)
      return;

    let selected = this.credentials.filter(
      (item) => item.pluginVerifiableCredential.getId() == this.credentialId
    );

    if (selected.length > 0)
      this.credential = selected[0];

    if (this.credential == null)
      return;

    this.checkIsCredentialInPublishedDIDDocument();
    this.checkIsCredentialInLocalDIDDocument();

    // Prepare the credential for display
    this.credential.onIconReady(iconSrc => this.iconSrc = iconSrc);
    this.credential.prepareForDisplay();

    await this.getIssuer();

    //await this.isLocalCredSyncOnChain();
    this.hasCheckedCredential = true;
  }

  async getIssuer() {
    let issuerDid = this.credential.pluginVerifiableCredential.getIssuer();
    //issuerDid = "did:elastos:ibXZJqeN19iTpvNvqo5vU9XH4PEGKhgS6d";
    if (isNil(issuerDid) || issuerDid == "") return;

    this.issuer = await this.profileService.getIssuerDisplayEntryFromID(
      issuerDid
    );
  }

  getDisplayableCredentialTitle(): string {
    return this.credential.getDisplayableTitle();
  }

  public hasDescription(): boolean {
    return !!this.credential.getDisplayableDescription();
  }

  public getDisplayableCredentialDescription(): string {
    return this.credential.getDisplayableDescription();
  }

  getDisplayableProperties() {
    let fragment = this.credential.pluginVerifiableCredential.getFragment();
    if (fragment === "avatar") return [];

    let subject = this.credential.pluginVerifiableCredential.getSubject();
    return Object.keys(subject)
      .filter((key) => key != "id")
      .sort()
      .map((prop) => {
        return {
          name: prop,
          value:
            subject[prop] != ""
              ? subject[prop]
              : this.translate.instant("identity.not-set"),
        };
      });
  }

  isAvatarCred(): boolean {
    let fragment = this.credential.pluginVerifiableCredential.getFragment();
    if (fragment === "avatar") {
      return true;
    } else {
      return false;
    }
  }

  getAvatar(): string {
    return this.avatarImg || transparentPixelIconDataUrl(); // Transparent pixel while loading
  }

  hasIssuerName() {
    return this.issuer.name !== null && this.issuer.name !== "";
  }

  isVerified() {
    let types = this.credential.pluginVerifiableCredential.getTypes();
    return !types.includes("SelfProclaimedCredential");
  }

  getCredIconSrc(): string {
    return this.iconSrc;

    /* let fragment = this.credential.pluginVerifiableCredential.getFragment();

    if (!this.basicCredentialService.getBasicCredentialkeys().some(x => x == fragment)) {
      fragment = "finger-print";
    }

    let skin = this.theme.darkMode ? "dark" : "light";
    return this.isVerified() ? `/assets/identity/headerIcons/${skin}/${fragment}-verified.svg` : `/assets/identity/headerIcons/${skin}/${fragment}.svg`; */
  }

  getSmallIcon(iconName: string) {
    return this.theme.darkMode ? `/assets/identity/smallIcons/dark/${iconName}.svg` : `/assets/identity/smallIcons/light/${iconName}.svg`
  }

  getCredIcon(): string {
    let fragment = this.credential.pluginVerifiableCredential.getFragment();
    switch (fragment) {
      case "avatar":
        return "image";
      case "wechat":
        return "logo-whatsapp";
      case "instagram":
        return "logo-instagram";
      case "facebook":
        return "logo-facebook";
      case "snapchat":
        return "logo-snapchat";
      case "twitter":
        return "logo-twitter";
      case "email":
        return "mail";
      case "birthDate":
        return "calendar";
      case "nation":
        return "flag";
      case "gender":
        return "transgender";
      case "telephone":
        return "call";
      case "nickname":
        return "glasses";
      case "birthPlace":
        return "globe";
      case "occupation":
        return "briefcase";
      case "education":
        return "school";
      case "interests":
        return "football";
      case "description":
        return "book";
      case "url":
        return "link";
      case "telegram":
        return "send";
      case "tiktok":
        return "logo-tiktok";
      case "twitch":
        return "logo-twitch";
      case "venmo":
        return "logo-venmo";
      case "paypal":
        return "logo-paypal";
      case "elaAddress":
        return "wallet";
      default:
        return "finger-print";
    }
  }

  transformDate(date): string {
    return moment(date).format("DD, MMMM YYYY");
  }

  getIssuanceDate(): string {
    return this.transformDate(
      this.credential.pluginVerifiableCredential.getIssuanceDate()
    );
  }

  getExpirationDate(): string {
    return this.transformDate(
      this.credential.pluginVerifiableCredential.getExpirationDate()
    );
  }

  issuerSegmentChanged(ev: any) {
    this.segment = ev.detail.value;
  }

  /******************** Display Data Sync Status between Local and Onchain ********************/
  getLocalCredByProperty(property: string): string {
    const credHasProp = (property in this.credential.pluginVerifiableCredential.getSubject());
    if (credHasProp)
      return this.credential.pluginVerifiableCredential.getSubject()[property];

    return null;
  }

  getOnChainCredByProperty(property: string): string {
    const chainValue = this.currentOnChainDIDDocument
      .getCredentials()
      .filter((c) => {
        if (property in c.getSubject()) {
          return c;
        }
      });

    return chainValue.length ? chainValue[0].getSubject()[property] : null;
  }

  /* async isLocalCredSyncOnChain() {
    let didString = this.didService.getActiveDid().getDIDString();
    this.currentOnChainDIDDocument = await this.didSyncService.onlineDIDDocumentsStatus.get(didString).value.document;
    if (this.currentOnChainDIDDocument === null) {
      this.isCredentialInLocalDocument = false;
      return false;
    }

    let fragment = this.credential.pluginVerifiableCredential.getFragment();
    let localValue = this.credential.pluginVerifiableCredential.getSubject()[fragment];

    let chainValue = this.currentOnChainDIDDocument.getCredentialById(new DIDURL("#" + fragment));
    if (!chainValue) {
      this.isCredentialInLocalDocument = false;
      return false;
    }

    if (!localValue) {
      // handle external credentials
      this.isCredentialInLocalDocument = true;
      return;
    }

    chainValue = chainValue.getSubject()[fragment];

    if (typeof localValue === "object" || typeof chainValue === "object") {
      //avatar
      this.isCredentialInLocalDocument = JSON.stringify(localValue) === JSON.stringify(chainValue);
      return;
    }

    Logger.log('Identity', 'Local ' + localValue + " ; Chain " + chainValue);
    this.isCredentialInLocalDocument = localValue === chainValue;
  } */

  private checkIsCredentialInPublishedDIDDocument() {
    if (!this.credential)
      this.isCredentialInPublishedDIDDocument = false;
    else
      this.isCredentialInPublishedDIDDocument = this.profileService.credentialIsInPublishedDIDDocument(this.credential.pluginVerifiableCredential);
  }

  private checkIsCredentialInLocalDIDDocument() {
    if (!this.credential)
      this.isCredentialInLocalDIDDocument = false;
    else
      this.isCredentialInLocalDIDDocument = this.profileService.credentialIsInLocalDIDDocument(this.credential.pluginVerifiableCredential);
  }

  async publishCredential(): Promise<void> {
    await this.authService.checkPasswordThenExecute(
      async () => {
        // Make the credential visible in the did document
        await this.profileService.setCredentialVisibility(this.credential.pluginVerifiableCredential.getFragment(), true, this.authService.getCurrentUserPassword());

        // Show the publish prompt
        void this.profileService.showWarning("publishVisibility", "");
      },
      () => {
      }
    );
  }

  verifyCredential() {
    let fragment = this.credential.pluginVerifiableCredential.getFragment();
    let localValue = this.credential.pluginVerifiableCredential.getSubject()[
      fragment
    ];

    let claimsObject = {
      id: this.didService.getActiveDid().getDIDString(),
    };

    claimsObject[fragment] = localValue;

    void this.globalIntentService.sendIntent(
      "https://did.elastos.net/credverify",
      {
        claims: claimsObject,
      }
    );
  }

  /**
   * User requests to delete this credential:
   * - confirm
   * - delete from DID document
   * - delete from store
   * - exit screen
   */
  private async deleteCredential() {
    Logger.log("identity", "Request to delete current credential");
    let deletionConfirmed = await this.globalPopupService.showConfirmationPopup(this.translate.instant('identity.delete-credential'), this.translate.instant('identity.delete-credential-info'));
    if (!deletionConfirmed)
      return; // Cancelled

    // Delete
    let wasDeleted = await this.credentialsService.deleteCredential(this.credential);
    Logger.log("identity", "Credential deletion result:", wasDeleted, ". Maybe exiting screen");

    // Exit
    if (wasDeleted)
      void this.globalNavService.navigateBack();
  }

  /**
   * Adds or removes the current credential from the local DID Document, ready for next publication.
   */
  public async onVisibilityChange(visible: boolean) {
    this.updatingVisibility = true;

    await this.authService.checkPasswordThenExecute(
      async () => {
        if (visible) {
          // Willing to make visible
          // If the credential is sensitive, make sure to let user confirm his choice first
          let relatedCredential = this.credential;
          if (relatedCredential.isSensitiveCredential()) {
            let confirmed = await this.globalPopupService.showConfirmationPopup("Sensitive information", "This information is marked as sensitive. Please double check that you really want to publish this");
            if (!confirmed) {
              this.isCredentialInLocalDIDDocument = false; // Revert user's UI choice as we cancel this.
              this.updatingVisibility = false;
              return;
            }
          }
        }

        // Instantly update (save) this change in the profile service - cannot undo
        await this.profileService.setCredentialVisibility(this.credential.pluginVerifiableCredential.getFragment(), visible, AuthService.instance.getCurrentUserPassword());
        this.updatingVisibility = false;

        if (visible)
          this.globalNativeService.genericToast(this.translate.instant('identity.change-visible'));
        else {
          if (this.isCredentialInPublishedDIDDocument)
            this.globalNativeService.genericToast(this.translate.instant('identity.change-unpublished'));
          else
            this.globalNativeService.genericToast(this.translate.instant('identity.change-not-published'));
        }
      },
      () => {
        this.updatingVisibility = false;
        this.isCredentialInLocalDIDDocument = !this.isCredentialInLocalDIDDocument; // Revert user's UI choice as we cancel this.
      }
    );
  }
}
