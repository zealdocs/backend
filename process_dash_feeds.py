#!/usr/bin/env python3

import argparse
import base64
import glob
import json
import io
import os
import sys

import xml.etree.ElementTree

import png

SOURCE_ID = 'com.kapeli'

PNG_CHUNK_WHITELIST = [b'IHDR', b'PLTE', b'IDAT', b'IEND', b'tRNS']


def read_icon(filename):
    if not os.path.exists(filename):
        print("ERROR: Cannot find file: {}".format(filename))
        sys.exit(1)

    reader = png.Reader(filename=filename)
    chunks = []
    for name, chunk in reader.chunks():
        if name in PNG_CHUNK_WHITELIST:
            chunks.append((name, chunk))

    output = io.BytesIO()
    png.write_chunks(output, chunks)
    return base64.b64encode(output.getvalue()).decode('ascii')


def main(argv=sys.argv[1:]):
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=argparse.FileType(), required=True)
    parser.add_argument('--blacklist', type=argparse.FileType())
    parser.add_argument('--resource-dir', required=True)
    parser.add_argument('feed_dir')
    parser.add_argument('output')
    args = parser.parse_args(argv)
    # print(args)

    manifest = json.load(args.manifest)
    blacklist = json.load(args.blacklist) if args.blacklist else []
    icon_dir = os.path.join(args.resource_dir, 'docset_icons')

    docset_list = []

    for feed_filename in sorted(glob.glob(os.path.join(args.feed_dir, '*.xml'))):
        print('\nProcessing {}...'.format(os.path.basename(feed_filename)))
        feed_name = os.path.splitext(os.path.basename(feed_filename))[0]

        if feed_name in blacklist:
            print("  ! {} is blacklisted.".format(feed_name))
            continue

        if feed_name not in manifest:
            # TODO: Report new docsets.
            print("  ! {} is NOT in manifest.".format(feed_name))
            continue

        entry = xml.etree.ElementTree.parse(feed_filename).getroot()

        # Split version and revision.
        s = entry.find('version').text.split('/')
        version = s[0]
        revision = s[1] if len(s) == 2 else '0'

        version_list = [v.text for v in entry.findall('./other-versions/version/name')]
        if not version_list and version:
            if version.startswith('.'):
                version = feed_name.split('_')[-1] + version

            version_list = [version]

        print('  -> Versions:', ", ".join(version_list) if version_list else '<none>')
        print('  -> Revision:', revision)

        feed_manifest = manifest[feed_name]

        docset_info = {
            'name': feed_name,
            'title': feed_manifest['title'],
            'sourceId': SOURCE_ID,
            'revision': revision,
            'versions': version_list,
            'icon': read_icon(os.path.join(icon_dir, feed_manifest['iconName'] + '.png')),
            'icon2x': read_icon(os.path.join(icon_dir, feed_manifest['iconName'] + '@2x.png'))
        }

        if 'extra' in feed_manifest:
            docset_info['extra'] = feed_manifest['extra']

        docset_list.append(docset_info)

    if docset_list:
        docset_list.sort(key=lambda d: d['name'].lower())

        with open(args.output, 'w') as f:
            json.dump(docset_list, f, indent=4)


if __name__ == '__main__':
    sys.exit(main())
