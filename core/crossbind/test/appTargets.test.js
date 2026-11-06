import { describe, expect, test } from 'vitest';
import { targetFrameworks, targetPlist, widgetsWithoutBackground } from '../src/utils/appTargets.js';

describe("an iOS app extension's Info.plist", () => {
    test("names its kind's extension point and its principal class, in its module where no Objective-C is beside it", () => {
        const share = targetPlist({
            name: 'share', kind: 'share', sources: ['Share.swift', 'resize.c'], principalClass: 'ShareViewController', activation: { images: 10, urls: 1, text: true },
        }, 'Notes', null);
        const service = targetPlist({ name: 'notify', kind: 'notification-service', sources: ['Service.h', 'Service.m'], principalClass: 'NotificationService' }, 'Notes', null);

        expect(share.NSExtension).toEqual({
            NSExtensionPointIdentifier: 'com.apple.share-services',
            NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController',
            NSExtensionAttributes: {
                NSExtensionActivationRule: {
                    NSExtensionActivationSupportsImageWithMaxCount: 10, NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true,
                },
            },
        });
        expect(service.NSExtension).toEqual({ NSExtensionPointIdentifier: 'com.apple.usernotifications.service', NSExtensionPrincipalClass: 'NotificationService' });
        expect(share).toMatchObject({ CFBundleDisplayName: 'Notes', CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundlePackageType: '$(PRODUCT_BUNDLE_PACKAGE_TYPE)' });
    });

    test("shows a content extension's categories, one as text and more as a list, at the content's size ratio of 1 its attributes may change", () => {
        const content = (categories, attributes) => targetPlist({
            name: 'invite', kind: 'notification-content', sources: ['Content.swift'], principalClass: 'ContentController', categories, attributes,
        }, 'Notes', null).NSExtension.NSExtensionAttributes;

        expect(content(['invite'])).toEqual({ UNNotificationExtensionCategory: 'invite', UNNotificationExtensionInitialContentSizeRatio: 1 });
        expect(content(['invite', 'reply'], { UNNotificationExtensionInitialContentSizeRatio: 0.5, UNNotificationExtensionUserInteractionEnabled: true })).toEqual({
            UNNotificationExtensionCategory: ['invite', 'reply'], UNNotificationExtensionInitialContentSizeRatio: 0.5, UNNotificationExtensionUserInteractionEnabled: true,
        });
    });

    test("gives an other target its own point and attributes, a widget none, and each that asks the App Group with its own name and keys", () => {
        const keys = targetPlist({
            name: 'keys', kind: 'other', sources: ['Keys.swift'], extensionPoint: 'com.apple.keyboard-service', principalClass: 'KeyboardViewController',
            attributes: { IsASCIICapable: true }, displayName: 'Keys', appGroup: true, plist: { CrossbindLayout: 'qwerty' },
        }, 'Notes', 'group.com.example.notes');
        const widget = targetPlist({ name: 'clock', kind: 'widget', sources: ['Clock.swift'] }, 'Notes', 'group.com.example.notes');

        expect(keys.NSExtension).toEqual({
            NSExtensionPointIdentifier: 'com.apple.keyboard-service', NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).KeyboardViewController', NSExtensionAttributes: { IsASCIICapable: true },
        });
        expect(keys).toMatchObject({ CFBundleDisplayName: 'Keys', CrossbindAppGroup: 'group.com.example.notes', CrossbindLayout: 'qwerty' });
        expect(widget.NSExtension).toEqual({ NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' });
        expect(widget).not.toHaveProperty('CrossbindAppGroup');
    });
});

describe("an iOS app extension's frameworks", () => {
    test("links a content extension with UserNotifications and UserNotificationsUI, whose classes iOS starts it with, beside its own", () => {
        expect(targetFrameworks({ kind: 'notification-content' })).toEqual(['UserNotifications', 'UserNotificationsUI']);
        expect(targetFrameworks({ kind: 'notification-content', frameworks: ['UserNotifications', 'CoreLocation'] }))
            .toEqual(['UserNotifications', 'UserNotificationsUI', 'CoreLocation']);
        expect(targetFrameworks({ kind: 'widget', frameworks: ['WidgetKit'] })).toEqual(['WidgetKit']);
        expect(targetFrameworks({ kind: 'share' })).toEqual([]);
    });
});

describe("an iOS app's widgets", () => {
    test("are told of where their Swift names no containerBackground, which iOS 17 asks of a widget's view", () => {
        const sources = {
            'Clock.swift': 'Text(entry.date).containerBackground(.background, for: .widget)', 'Plain.swift': 'Text(entry.date)', 'Share.swift': 'Text("share")',
        };
        const targets = [
            { name: 'clock', kind: 'widget', sources: ['Clock.swift'] },
            { name: 'plain', kind: 'widget', sources: ['Plain.swift', 'helper.m'] },
            { name: 'share', kind: 'share', sources: ['Share.swift'] },
        ];

        expect(widgetsWithoutBackground(targets, (target, file) => sources[file])).toEqual(['plain']);
    });
});
