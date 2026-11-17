"""Small opt-in diagnostic; does not write source HTML."""
import argparse
import sys
from extract import fetch_page


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    args = parser.parse_args()
    page = fetch_page(args.url)
    print('STATUS', page.status)
    print(page.css('h1, h2').getall())
    for label in ('경력', '근무지주소', '마감일'):
        print(label, page.xpath('//*[not(*) and normalize-space(text())="' + label + '"]/parent::*').getall())
    print(page.xpath('//*[not(*) and normalize-space(text())="마감일"]/parent::*/parent::*').getall())


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
