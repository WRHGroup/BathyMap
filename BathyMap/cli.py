import click
import os
import sys
import logging
from BathyMap.site_builder import BathymetrySiteBuilder

logger = logging.getLogger(__name__)


@click.group()
def cli():
    pass


@cli.command(name='build', help="Build the bathymetry map website from the raw data files.")
@click.option('-f', '--file-name', type=str, default="1_site_config.json", help="JSON file containing the website config.")
def build(file_name):
    logger.info('Starting the process.')
    SiteModel = BathymetrySiteBuilder(json_file=file_name)
    SiteModel.setup()
    SiteModel.execute()


def start_cli():
    """ Start the command line interface. """
    from . import logger
    import sys
    logger.setLevel(logging.DEBUG)
    ch = logging.StreamHandler(stream=sys.stdout)
    logger.addHandler(ch)

    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    ch.setFormatter(formatter)
    cli(obj={})
