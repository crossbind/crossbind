import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageOf, takenNames } from '../index.js';
import { uploadParts } from './appStoreApi.js';

const placements = { header: 'PRODUCT_PAGE_HEADER_ASSET', 'search-results': 'APP_STORE_SEARCH_RESULTS_ASSET' };
const group = 'DEFAULT_PROFILE';
const category = 'CREATIVE_ASSETS';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const maximumBytes = 500 * 1024 * 1024;

export function readCreativeAssets(store, project, folder) {
    if (!fs.existsSync(folder)) return {};
    const names = takenNames(store, project, folder, (name, isDir) => {
        const { name: role, ext } = path.parse(name);
        return !isDir && (role === 'universal' || Object.hasOwn(placements, role)) && /^\.(png|jpe?g|id)$/i.test(ext);
    });
    const assets = {};
    for (const name of names) {
        const [role, extension] = name.split('.');
        const file = path.join(folder, name);
        if (assets[role]) throw new Error(`crossbind: ${path.relative(project, folder)} has two files for ${role}. Choose one image or one Asset Library ID for that role.`);
        if (extension.toLowerCase() === 'id') {
            const id = fs.readFileSync(file, 'utf8').trim();
            if (!uuid.test(id)) throw new Error(`crossbind: ${path.relative(project, file)} must contain one Asset Library image ID (UUID).`);
            assets[role] = { file, id: id.toLowerCase() };
        } else {
            assets[role] = { file };
        }
    }
    return assets;
}

function fits(role, { width, height, format }) {
    if (width === 5244 && height === 2950) return format === 'png';
    if (role === 'header') return width === 3840 && height === 1646 && format === 'png';
    return role === 'search-results' && width >= 1920 && width <= 3840 && width * 2 === height * 3;
}

const sizes = {
    universal: 'a 5244 × 2950 PNG',
    header: 'a 3840 × 1646 or 5244 × 2950 PNG',
    'search-results': 'a 3:2 PNG or JPEG from 1920 × 1280 to 3840 × 2560, or a 5244 × 2950 PNG',
};

export function creativeAssetProblems(project, assets = {}) {
    return Object.entries(assets).flatMap(([role, { file, id }]) => {
        if (id) return [];
        const shown = path.relative(project, file);
        if (fs.statSync(file).size > maximumBytes) return [`crossbind: ${shown} exceeds the 500 MiB creative asset limit.`];
        const image = imageOf(file);
        const format = /\.png$/i.test(file) ? 'png' : 'jpeg';
        if (!image || image.format !== format) return [`crossbind: ${shown} must contain a PNG or JPEG matching its filename.`];
        const problems = [];
        if (!fits(role, image)) problems.push(`crossbind: ${shown} is ${image.width} × ${image.height} ${image.format.toUpperCase()}. App Store Connect takes ${sizes[role]} for ${role}.`);
        if (image.hasAlpha) problems.push(`crossbind: ${shown} contains transparency. Export an opaque image for ${role}.`);
        return problems;
    });
}

const link = (type, id) => ({ data: { type, id } });
const unusable = new Set(['FAILED', 'REJECTED', 'ARCHIVED']);

async function libraryImage(call, library, role, { file, id }) {
    const bytes = id ? null : fs.readFileSync(file);
    const referenceName = bytes && `crossbind-${createHash('sha256').update(bytes).digest('hex').slice(0, 40)}`;
    const filters = new URLSearchParams({ 'filter[category]': category, ...(id ? { 'filter[id]': id } : { 'filter[referenceName]': referenceName }) });
    const { data: matches } = await call('GET', `/appAssetLibraries/${library}/images?${filters}`);
    let image = matches.find((one) => id ? one.id === id
        : one.attributes.referenceName === referenceName && !unusable.has(one.attributes.state));
    if (!image && id) throw new Error(`crossbind: ${file} names ${id}, which is missing from this app’s creative asset library.`);
    if (!image) {
        const attributes = { fileName: path.basename(file), fileSize: bytes.length, category, referenceName };
        const relationships = { assetLibrary: link('appAssetLibraries', library) };
        ({ data: image } = await call('POST', '/appAssetLibraryImages', { data: { type: 'appAssetLibraryImages', attributes, relationships } }));
    }
    const route = `/appAssetLibraryImages/${image.id}`;
    if (image.attributes.state === 'AWAITING_UPLOAD') {
        if (id) throw new Error(`crossbind: the image ${file} names is still awaiting upload. Supply the image file to upload it.`);
        if (!image.attributes.uploadOperations) ({ data: image } = await call('GET', route));
        await uploadParts(image.attributes.uploadOperations, bytes, file);
        await call('PATCH', route, { data: { type: 'appAssetLibraryImages', id: image.id, attributes: { uploaded: true } } });
        ({ data: image } = await call('GET', route));
    }
    const deadline = Date.now() + 10 * 60_000;
    while (['AWAITING_UPLOAD', 'UPLOAD_COMPLETE'].includes(image.attributes.state)) {
        if (Date.now() >= deadline) throw new Error(`crossbind: App Store Connect is still processing ${file} after 10 minutes. Run the command again to resume.`);
        await new Promise((resolve) => { setTimeout(resolve, 5000); });
        ({ data: image } = await call('GET', route));
    }
    const { state, stateDetails, imageAsset, specId, fileName } = image.attributes;
    if (unusable.has(state) || !specId || !imageAsset) {
        throw new Error(`crossbind: App Store Connect marked ${file} as ${state}.${stateDetails ? ` ${JSON.stringify(stateDetails)}` : ''}`);
    }
    if (!fits(role, { ...imageAsset, format: /\.png$/i.test(fileName) ? 'png' : 'jpeg' })) {
        throw new Error(`crossbind: Asset Library image ${image.id} for ${file} does not fit ${role}. Use ${sizes[role]}.`);
    }
    return image.id;
}

function place(call, localization, placementType, media) {
    return call('POST', '/appAssetLibraryPlacements', { data: {
        type: 'appAssetLibraryPlacements', attributes: { placementType, placementGroup: group },
        relationships: { ...media, appStoreVersionLocalization: link('appStoreVersionLocalizations', localization) },
    } });
}

// Resolve every replacement before removing an existing placement. Apple keeps the library image or video
// when its placement is deleted, so a rejected replacement can restore the previous artwork.
export async function updateCreativeAssets(call, appId, localization, assets) {
    const { data: library } = await call('GET', `/apps/${appId}/assetLibrary`);
    const wanted = {};
    for (const [role, asset] of Object.entries(assets)) {
        if (role === 'universal' && assets.header && assets['search-results']) continue;
        wanted[role] = await libraryImage(call, library.id, role, asset);
    }
    const filters = new URLSearchParams({ 'filter[placementGroup]': group, 'filter[placementType]': Object.values(placements).join(','), include: 'image,video' });
    const list = async () => (await call('GET', `/appStoreVersionLocalizations/${localization}/placements?${filters}`)).data;
    const current = await list();
    let changed = false;
    for (const [role, type] of Object.entries(placements)) {
        const id = wanted[role] ?? wanted.universal;
        if (!id) continue;
        const old = current.find(({ attributes }) => attributes.placementGroup === group && attributes.placementType === type);
        if (old?.relationships?.image?.data?.id === id) continue;
        const previous = old?.relationships?.image?.data ?? old?.relationships?.video?.data;
        if (old && !previous?.id) throw new Error(`crossbind: App Store Connect did not identify the media in ${role} for localization ${localization}.`);
        if (old) await call('DELETE', `/appAssetLibraryPlacements/${old.id}`);
        try {
            await place(call, localization, type, { image: link('appAssetLibraryImages', id) });
        } catch (error) {
            // A lost POST response can mean the slot is already filled. Check before restoring anything.
            const now = (await list()).find(({ attributes }) => attributes.placementGroup === group && attributes.placementType === type);
            if (now?.relationships?.image?.data?.id !== id) {
                if (!now && previous) {
                    const media = previous.type === 'appAssetLibraryVideos' ? 'video' : 'image';
                    await place(call, localization, type, { [media]: { data: previous } });
                }
                throw error;
            }
        }
        changed = true;
    }
    return changed;
}
