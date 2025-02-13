import { Component, ViewChild } from '@angular/core';
import { NavController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { TitleBarComponent } from 'src/app/components/titlebar/titlebar.component';
import { TitleBarForegroundMode } from 'src/app/components/titlebar/titlebar.types';
import { App } from 'src/app/model/app.enum';
import { GlobalNavService } from 'src/app/services/global.nav.service';
import { Packet } from '../../model/packets.model';
import { PacketService } from '../../services/packet.service';

@Component({
  selector: 'page-my-packets',
  templateUrl: 'my-packets.html',
  styleUrls: ['./my-packets.scss'],
})
export class MyPacketsPage {
  // UI components
  @ViewChild(TitleBarComponent, { static: true }) titleBar: TitleBarComponent;

  // Model
  public packets: Packet[] = [];

  constructor(
    public navCtrl: NavController,
    private globalNavService: GlobalNavService,
    public packetService: PacketService,
    private translate: TranslateService
  ) { }

  ionViewWillEnter() {
    this.titleBar.setTitle(this.translate.instant("redpackets.my-packets"));
    this.titleBar.setBackgroundColor("#701919");
    this.titleBar.setForegroundMode(TitleBarForegroundMode.LIGHT);

    this.packets = this.packetService.getMyPackets();
  }

  ionViewWillLeave() {
  }

  public openPacketDetails(packet: Packet) {
    void this.globalNavService.navigateTo(App.RED_PACKETS, "/redpackets/packet-details", {
      state: {
        packet: packet
      }
    });
  }
}
