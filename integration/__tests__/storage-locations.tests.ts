/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The session of the Backup Storage Locations, one of the five of the integration test, as the template has
// one for each version of its kind: a storage location of its own, in a namespace of its own on the cluster
// of the test environment, which the page of the storage locations lists, the details of the host show with
// the section of the extension, and the host gives a menu of its commands, to which the extension adds no
// item. The session starts the application in a new profile, removes the namespace when it ends, and does
// not depend on another file having run.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../helpers/velero-cluster";
import * as velero from "../helpers/velero-extension";
import * as kinds from "../helpers/velero-kinds";

import type { Frame } from "playwright";

const TIMEOUT = 10 * 60 * 1000;
const session = kinds.SESSIONS.storageLocations;

describe(`the views of a ${session.kind}`, () => {
  let started: velero.StartedApplication | undefined;
  let frame: Frame;
  let logged: Record<string, string[]> = {};
  const errors = velero.createErrorCollector();

  beforeAll(async () => {
    kinds.placeObject(session);
    errors.start();
    let kubeconfig = "";

    // The store of the profile names the kubeconfig of the environment as the only one the catalog syncs.
    started = await velero.startWithExtension(async (application) => {
      errors.watch(application.window);
      kubeconfig = await cluster.publishKubeconfig();
    });
    await velero.dismissNotifications(started.window);
    await velero.navigateToCatalog(started.app);
    expect(await velero.catalogClusterCount(started.window)).toBe(1);
    frame = await cluster.openClusterFromCatalog(started.window, kubeconfig);
  }, TIMEOUT);

  afterAll(async () => {
    try {
      // The files of the log of the host are read while it runs, its output and its console until it is closed.
      if (started) logged = await velero.hostLogErrors(started.app);
      await started?.cleanup();
      if (started) errors.stop(started.window);
    } finally {
      kinds.removeObject(session);
    }
    expect(errors.errors()).toEqual([]);
    expect(Object.values(logged).flat()).toEqual([]);
    expect(kinds.leftOf(session)).toEqual([]);
  }, TIMEOUT);

  it(
    "lists the test object",
    async () => {
      await kinds.openList(frame, session);
    },
    TIMEOUT,
  );

  it(
    "shows the test object in the details of the host, with the section of the extension",
    async () => {
      await kinds.openList(frame, session);
      expect(await kinds.openDetails(frame, session)).toEqual({
        installation: session.namespace,
        links: 1,
        errorPages: 0,
      });
    },
    TIMEOUT,
  );

  it(
    "leaves the menu of the test object to the host, with no item of the extension",
    async () => {
      expect(await kinds.openMenu(frame, session)).toEqual([
        { title: "Edit", ofTheHost: true },
        { title: "Delete", ofTheHost: true },
      ]);
    },
    TIMEOUT,
  );
});
