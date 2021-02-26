import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { NgZone} from '@angular/core';
import { GlobalStorageService } from 'src/app/services/global.storage.service';
import { HiveService, VaultLinkStatus } from '../../services/hive.service';
import { ActivatedRoute } from '@angular/router';
import { AppService } from '../../services/app.service';
import { GlobalThemeService } from 'src/app/services/global.theme.service';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-pickplan',
  templateUrl: './pickplan.page.html',
  styleUrls: ['./pickplan.page.scss'],
})
export class PickPlanPage implements OnInit {
  public fetchingPlans = true;
  public pricingInfo: HivePlugin.Payment.PricingInfo = null;

  constructor(
    public navCtrl: NavController,
    public zone: NgZone,
    private storage: GlobalStorageService,
    private hiveService: HiveService,
    private route: ActivatedRoute,
    private appService: AppService,
    public theme: GlobalThemeService,
    private translate: TranslateService,
  ) {}

  ngOnInit() {
    this.route.queryParams.subscribe((data) => {
      //console.log("QUERY PARAMS", data);
    });
  }

  async ionViewWillEnter() {
    // TODO @chad titleBarManager.setTitle(this.translate.instant('pickplan.title'));

    await this.tryToFinalizePreviousOrders();
    await this.fetchPlans();
  }

  /* TODO @chad ionViewDidEnter(){
    this.uxService.setTitleBarBackKeyShown(true);
  }

  ionViewWillLeave() {
    this.uxService.setTitleBarBackKeyShown(false);
  }*/

  private async tryToFinalizePreviousOrders() {
    this.hiveService.tryToFinalizePreviousOrders();
  }

  private async fetchPlans() {
    this.pricingInfo = await this.hiveService.getPricingInfo();
    console.log("Received pricing info:", this.pricingInfo);
    console.log("Pricing info plans:", this.pricingInfo.getPricingPlans());
    console.log("Pricing info settings:", this.pricingInfo.getPaymentSettings());

    this.fetchingPlans = false;
  }

  public pickPlan(plan: HivePlugin.Payment.PricingPlan) {
    console.log("pick plan", plan);

    this.navCtrl.navigateForward("pickplanpurchase", {
      queryParams: {
        planName: plan.getName()
      }
    });
  }
}
