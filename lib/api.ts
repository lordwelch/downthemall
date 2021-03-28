"use strict";
// License: MIT

import { TYPE_LINK, TYPE_MEDIA } from "./constants";
import { filters } from "./filters";
import { Prefs } from "./prefs";
import { lazy } from "./util";
// eslint-disable-next-line no-unused-vars
import { Item, makeUniqueItems, BaseItem } from "./item";
import { getManager } from "./manager/man";
import { select } from "./select";
import { single } from "./single";
import { Notification } from "./notifications";
import { MASK, FASTFILTER, SUBFOLDER, SERVER } from "./recentlist";
import { openManager } from "./windowutils";
import { _ } from "./i18n";

const MAX_BATCH = 10000;

export interface QueueOptions {
  mask?: string;
  subfolder?: string;
  server?: string;
  paused?: boolean;
  cookies?: boolean;
}

export const API = new class APIImpl {
  async filter(arr: BaseItem[], type: number) {
    return await (await filters()).filterItemsByType(arr, type);
  }

  async queue(items: BaseItem[], options: QueueOptions) {
    await Promise.all([MASK.init(), SUBFOLDER.init()]);
    const {mask = MASK.current} = options;
    const {subfolder = SUBFOLDER.current} = options;
    const {server = SERVER.current} = options;

    const {paused = false} = options;
    const {cookies = false} = options;
    const defaults: any = {
      _idx: 0,
      get idx() {
        return ++this._idx;
      },
      referrer: null,
      usableReferrer: null,
      fileName: null,
      title: "",
      description: "",
      startDate: new Date(),
      private: false,
      postData: null,
      mask,
      subfolder,
      server,
      date: Date.now(),
      paused,
      cookies,
    };
    let currentBatch = await Prefs.get("currentBatch", 0);
    const initialBatch = currentBatch;
    lazy(defaults, "batch", () => {
      if (++currentBatch >= MAX_BATCH) {
        currentBatch = 0;
      }
      return currentBatch;
    });
    items = items.map(i => {
      delete i.idx;
      return new Item(i, defaults);
    });
    if (!items) {
      return;
    }
    if (initialBatch !== currentBatch) {
      await Prefs.set("currentBatch", currentBatch);
    }
    const manager = await getManager();
    await manager.addNewDownloads(items);
    if (await Prefs.get("queue-notification")) {
      if (items.length === 1) {
        new Notification(null, _("queued-download"));
      }
      else {
        new Notification(null, _("queued-downloads", items.length));
      }
    }
    if (false && await Prefs.get("open-manager-on-queue")) {
      await openManager(false);
    }
  }

  sanity(links: BaseItem[], media: BaseItem[]) {
    if (!links.length && !media.length) {
      new Notification(null, _("no-links"));
      return false;
    }
    return true;
  }

  async turbo(links: BaseItem[], media: BaseItem[]) {
    if (!this.sanity(links, media)) {
      return false;
    }
    const type = await Prefs.get("last-type", "links");
    const items = await (async () => {
      if (type === "links") {
        return await API.filter(links, TYPE_LINK);
      }
      return await API.filter(media, TYPE_MEDIA);
    })();
    const selected = makeUniqueItems([items]);
    if (!selected.length) {
      return await this.regular(links, media);
    }
    return await this.queue(selected, {paused: await Prefs.get("add-paused")});
  }

  async regularInternal(selected: BaseItem[], options: any) {
    if (options.mask && !options.maskOnce) {
      await MASK.init();
      await MASK.push(options.mask);
    }
    if (typeof options.fast === "string" && !options.fastOnce) {
      await FASTFILTER.init();
      await FASTFILTER.push(options.fast);
    }
    if (typeof options.subfolder === "string" && !options.subfolderOnce) {
      await SUBFOLDER.init();
      await SUBFOLDER.push(options.subfolder);
    }
    if (typeof options.server === "string" && !options.serverOnce) {
      await SERVER.init();
      await SERVER.push(options.server);
    }
    if (typeof options.type === "string") {
      await Prefs.set("last-type", options.type);
    }
    return await this.queue(selected, options);
  }

  async regular(links: BaseItem[], media: BaseItem[]) {
    if (!this.sanity(links, media)) {
      return false;
    }
    const {items, options} = await select(links, media);
    return this.regularInternal(items, options);
  }

  async singleTurbo(item: BaseItem) {
    return await this.queue([item], {paused: await Prefs.get("add-paused")});
  }

  async singleRegular(item: BaseItem | null) {
    const {items, options} = await single(item);
    return this.regularInternal(items, options);
  }
}();
