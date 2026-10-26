# loading necessary packages
import os
import re
import json
import math
import time
import stat
import shutil
import datetime
import numpy as np
import pandas as pd
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import cKDTree, Delaunay
from pyproj import Transformer
import logging
logger = logging.getLogger(__name__)


class BathymetrySiteBuilder(object):
    """
    This class includes methods for reading raw bathymetry survey files (currently CHC .dep exports), converting
    their coordinates to decimal degrees, and writing a static website (map data, CSV downloads and copies of the raw
    files) that can be published with GitHub Pages.
    """

    def __init__(self, json_file, *args, **kwargs):
        """
        Initialise a new BathymetrySiteBuilder object.

        Args:
            json_file: JSON-based document specifying the configuration information for building the website.
        """
        super().__init__(*args, **kwargs)
        self.json_file = json_file

    def load_data_from_json(self):
        """
        Loads the configuration JSON-based document assigned to self.json_file. Extracts the data from the JSON-based
        document and assign them to self.data_directory, self.site_template_directory, self.output_directory and the
        settings that control the content of the website.

        """
        data = os.path.normpath(os.path.join(os.getcwd(), self.json_file))
        self.json_file_directory = os.path.normpath(os.path.dirname(data))

        if isinstance(data, str):
            logging.info('Loading data from file: "{}"'.format(data))
            with open(data, "r") as f:
                loaded_file = json.load(f)

        if loaded_file.get('data_directory') is None:
            raise ValueError('data_directory has not been found in the JSON file')
        self.data_directory = os.path.normpath(os.path.join(self.json_file_directory, loaded_file.pop('data_directory')))

        if loaded_file.get('site_template_directory') is None:
            print('site template directory set to "site". If you wish to change this default value, add site_template_directory to the inputs provided in the JSON file')
            self.site_template_directory = os.path.normpath(os.path.join(self.json_file_directory, 'site'))
        else:
            self.site_template_directory = os.path.normpath(os.path.join(self.json_file_directory, loaded_file.pop('site_template_directory')))

        if loaded_file.get('output_directory') is None:
            print('output directory set to "docs". If you wish to change this default value, add output_directory to the inputs provided in the JSON file')
            self.output_directory = os.path.normpath(os.path.join(self.json_file_directory, 'docs'))
        else:
            self.output_directory = os.path.normpath(os.path.join(self.json_file_directory, loaded_file.pop('output_directory')))

        if loaded_file.get('site_title') is None:
            print('site title set to "BathyMap". If you wish to change this default value, add site_title to the inputs provided in the JSON file')
            self.site_title = 'BathyMap'
        else:
            self.site_title = loaded_file.pop('site_title')

        if loaded_file.get('site_description') is None:
            print('site description set to an empty string. If you wish to change this default value, add site_description to the inputs provided in the JSON file')
            self.site_description = ''
        else:
            self.site_description = loaded_file.pop('site_description')

        if loaded_file.get('organisation') is None:
            print('organisation set to an empty string. If you wish to change this default value, add organisation to the inputs provided in the JSON file')
            self.organisation = ''
        else:
            self.organisation = loaded_file.pop('organisation')

        if loaded_file.get('contact') is None:
            print('contact set to an empty string. If you wish to change this default value, add contact to the inputs provided in the JSON file')
            self.contact = ''
        else:
            self.contact = loaded_file.pop('contact')

        if loaded_file.get('licence') is None:
            print('licence set to an empty string. If you wish to change this default value, add licence to the inputs provided in the JSON file')
            self.licence = ''
        else:
            self.licence = loaded_file.pop('licence')

        if loaded_file.get('repository_url') is None:
            print('repository url set to an empty string. If you wish to change this default value, add repository_url to the inputs provided in the JSON file')
            self.repository_url = ''
        else:
            self.repository_url = loaded_file.pop('repository_url').rstrip('/')

        if loaded_file.get('repository_branch') is None:
            print('repository branch set to "main". If you wish to change this default value, add repository_branch to the inputs provided in the JSON file')
            self.repository_branch = 'main'
        else:
            self.repository_branch = loaded_file.pop('repository_branch')

        if loaded_file.get('file_extensions') is None:
            print('file extensions set to [".dep"]. If you wish to change this default value, add file_extensions to the inputs provided in the JSON file')
            self.file_extensions = ['.dep']
        else:
            self.file_extensions = loaded_file.pop('file_extensions')

        if loaded_file.get('accepted_gps_states') is None:
            print('accepted GPS states set to [] (all points are kept). If you wish to change this default value, add accepted_gps_states to the inputs provided in the JSON file')
            self.accepted_gps_states = []
        else:
            self.accepted_gps_states = loaded_file.pop('accepted_gps_states')

        if loaded_file.get('max_map_points_per_line') is None:
            print('maximum number of map points per line set to 3000. If you wish to change this default value, add max_map_points_per_line to the inputs provided in the JSON file')
            self.max_map_points_per_line = 3000
        else:
            self.max_map_points_per_line = loaded_file.pop('max_map_points_per_line')

        if loaded_file.get('max_track_points_per_line') is None:
            print('maximum number of track points per line set to 200. If you wish to change this default value, add max_track_points_per_line to the inputs provided in the JSON file')
            self.max_track_points_per_line = 200
        else:
            self.max_track_points_per_line = loaded_file.pop('max_track_points_per_line')

        if loaded_file.get('copy_raw_files') is None:
            print('copy raw files set to True. If you wish to change this default value, add copy_raw_files to the inputs provided in the JSON file')
            self.copy_raw_files = True
        else:
            self.copy_raw_files = loaded_file.pop('copy_raw_files')

        if loaded_file.get('write_combined_csv') is None:
            print('write combined csv set to True. If you wish to change this default value, add write_combined_csv to the inputs provided in the JSON file')
            self.write_combined_csv = True
        else:
            self.write_combined_csv = loaded_file.pop('write_combined_csv')

        if loaded_file.get('depth_colour_range') is None:
            print('depth colour range set to automatic (2nd to 98th percentile of all depths). If you wish to change this default value, add depth_colour_range to the inputs provided in the JSON file')
            self.depth_colour_range = None
        else:
            self.depth_colour_range = loaded_file.pop('depth_colour_range')

        if loaded_file.get('time_reference') is None:
            print('time reference set to "as logged by the instrument". If you wish to change this default value, add time_reference to the inputs provided in the JSON file')
            self.time_reference = 'as logged by the instrument'
        else:
            self.time_reference = loaded_file.pop('time_reference')

        if loaded_file.get('survey_metadata') is None:
            print('survey metadata set to {} (each data folder can still describe itself in a metadata.json file). If you wish to change this default value, add survey_metadata to the inputs provided in the JSON file')
            self.survey_metadata = {}
        else:
            self.survey_metadata = loaded_file.pop('survey_metadata')

        if loaded_file.get('metadata_file_name') is None:
            print('metadata file name set to "metadata.json". If you wish to change this default value, add metadata_file_name to the inputs provided in the JSON file')
            self.metadata_file_name = 'metadata.json'
        else:
            self.metadata_file_name = loaded_file.pop('metadata_file_name')

        if loaded_file.get('depth_reference') is None:
            print('depth reference set to "as logged by the instrument". If you wish to change this default value, add depth_reference to the inputs provided in the JSON file')
            self.depth_reference = 'as logged by the instrument'
        else:
            self.depth_reference = loaded_file.pop('depth_reference')

        if loaded_file.get('map_variables') is None:
            print('map variables set to the bathymetry, survey and quality columns of CHC files. If you wish to change this default value, add map_variables to the inputs provided in the JSON file')
            self.map_variables = [
                {'column': 'Depth', 'label': 'Water depth', 'unit': 'm', 'colours': 'depth', 'decimals': 3, 'group': 'Bathymetry'},
                {'column': 'Height - Depth', 'label': 'Bed elevation', 'note': 'GNSS height minus water depth. Above the ellipsoid, not sea level', 'unit': 'm', 'colours': 'elevation', 'decimals': 3, 'group': 'Bathymetry'},
                {'column': 'Height', 'label': 'GNSS height', 'note': 'Above the ellipsoid, not sea level', 'unit': 'm', 'colours': 'sequential', 'decimals': 3, 'group': 'Bathymetry'},
                {'column': 'Time of day', 'label': 'Time of day', 'unit': '', 'colours': 'sequential', 'decimals': 0, 'format': 'time', 'group': 'Survey'},
                {'column': 'Trail Distance', 'label': 'Distance along line', 'note': 'From the first sounding of each line', 'unit': 'm', 'from_line_start': True, 'colours': 'sequential', 'decimals': 1, 'group': 'Survey'},
                {'column': 'Speed', 'label': 'Platform speed', 'unit': 'm/s', 'colours': 'sequential', 'decimals': 2, 'group': 'Survey'},
                {'column': 'Flow Velocity', 'label': 'Flow velocity', 'unit': 'm/s', 'colours': 'sequential', 'decimals': 2, 'group': 'Survey'},
                {'column': 'Roll', 'label': 'Roll', 'note': 'Logged in radians, shown in degrees', 'unit': '°', 'scale': 57.29578, 'colours': 'diverging', 'decimals': 1, 'group': 'Quality'},
                {'column': 'Pitch', 'label': 'Pitch', 'note': 'Logged in radians, shown in degrees', 'unit': '°', 'scale': 57.29578, 'colours': 'diverging', 'decimals': 1, 'group': 'Quality'},
                {'column': 'Diff Delay', 'label': 'Correction age', 'note': 'Age of the RTK corrections', 'unit': 's', 'colours': 'sequential', 'decimals': 1, 'group': 'Quality'},
                {'column': 'HRMS', 'label': 'Horizontal precision', 'unit': 'm', 'colours': 'sequential', 'decimals': 3, 'group': 'Quality'},
                {'column': 'VRMS', 'label': 'Vertical precision', 'unit': 'm', 'colours': 'sequential', 'decimals': 3, 'group': 'Quality'},
                {'column': 'GPS State', 'label': 'GPS state', 'note': '1 GPS, 2 DGPS, 4 RTK fixed, 5 RTK float', 'unit': '', 'colours': 'sequential', 'decimals': 0, 'group': 'Quality'}
            ]
        else:
            self.map_variables = loaded_file.pop('map_variables')
        if len(self.map_variables) == 0 or self.map_variables[0].get('column') != 'Depth':
            print('Depth is added as the first map variable, so the map opens coloured by water depth')
            self.map_variables.insert(0, {'column': 'Depth', 'label': 'Water depth', 'unit': 'm', 'colours': 'depth', 'decimals': 3})
        for map_variable in self.map_variables:
            if map_variable.get('column') is None:
                raise ValueError('each entry of map_variables needs a "column" key, for example {"column": "Speed"}')
            if map_variable.get('colours', 'sequential') not in ['depth', 'elevation', 'sequential', 'diverging']:
                raise ValueError('the colours of the map variable "{}" must be "depth", "elevation", "sequential" or "diverging"'.format(map_variable['column']))

        if loaded_file.get('height_reference') is None:
            print('height reference set to "as logged by the instrument". If you wish to change this default value, add height_reference to the inputs provided in the JSON file')
            self.height_reference = 'as logged by the instrument'
        else:
            self.height_reference = loaded_file.pop('height_reference')

        if loaded_file.get('default_basemap') is None:
            print('default basemap set to "openstreetmap". If you wish to change this default value, add default_basemap to the inputs provided in the JSON file')
            self.default_basemap = 'openstreetmap'
        else:
            self.default_basemap = loaded_file.pop('default_basemap')
        basemap_names = ['openstreetmap', 'satellite', 'street', 'topographic', 'light', 'dark', 'ocean', 'carto-voyager', 'carto-positron']
        if self.default_basemap not in basemap_names:
            raise ValueError('default_basemap must be one of: {}'.format(', '.join(basemap_names)))

        if loaded_file.get('carto_api_key') is None:
            print('CARTO API key set to "" (the CARTO basemaps are not offered). If you wish to change this default value, add carto_api_key to the inputs provided in the JSON file')
            self.carto_api_key = ''
        else:
            self.carto_api_key = loaded_file.pop('carto_api_key')
        if self.default_basemap.startswith('carto') and self.carto_api_key == '':
            raise ValueError('default_basemap "{}" needs a carto_api_key in the JSON file'.format(self.default_basemap))

        if loaded_file.get('start_with_list_collapsed') is None:
            print('start with list collapsed set to True. If you wish to change this default value, add start_with_list_collapsed to the inputs provided in the JSON file')
            self.start_with_list_collapsed = True
        else:
            self.start_with_list_collapsed = loaded_file.pop('start_with_list_collapsed')

        if loaded_file.get('interpolate_bed') is None:
            print('interpolate bed set to True (each survey day gets a 3D view of the interpolated bed). If you wish to change this default value, add interpolate_bed to the inputs provided in the JSON file')
            self.interpolate_bed = True
        else:
            self.interpolate_bed = loaded_file.pop('interpolate_bed')

        if loaded_file.get('bed_grid_spacing') is None:
            print('bed grid spacing set to 0.5 m. If you wish to change this default value, add bed_grid_spacing to the inputs provided in the JSON file')
            self.bed_grid_spacing = 0.5
        else:
            self.bed_grid_spacing = float(loaded_file.pop('bed_grid_spacing'))

        if loaded_file.get('bed_max_distance') is None:
            print('bed max distance set to 0 m (the bed is only filled between two passes of the survey, never beside a lone pass). If you wish to change this default value, add bed_max_distance to the inputs provided in the JSON file')
            self.bed_max_distance = 0.0
        else:
            self.bed_max_distance = float(loaded_file.pop('bed_max_distance'))

        if loaded_file.get('bed_max_gap') is None:
            print('bed max gap set to 30 m (the bed is filled between passes of the survey up to this distance apart). If you wish to change this default value, add bed_max_gap to the inputs provided in the JSON file')
            self.bed_max_gap = 30.0
        else:
            self.bed_max_gap = float(loaded_file.pop('bed_max_gap'))

        if loaded_file.get('bed_pass_ratio') is None:
            print('bed pass ratio set to 2 (two soundings are on different passes when the track between them is more than twice the distance between them). If you wish to change this default value, add bed_pass_ratio to the inputs provided in the JSON file')
            self.bed_pass_ratio = 2.0
        else:
            self.bed_pass_ratio = float(loaded_file.pop('bed_pass_ratio'))

        if loaded_file.get('vertical_exaggeration') is None:
            print('vertical exaggeration set to "auto" (the deepest point of each 3D view lies a tenth of its width below the water surface). If you wish to change this default value, add vertical_exaggeration to the inputs provided in the JSON file')
            self.vertical_exaggeration = 'auto'
        else:
            self.vertical_exaggeration = loaded_file.pop('vertical_exaggeration')
        if self.vertical_exaggeration != 'auto' and not (isinstance(self.vertical_exaggeration, (int, float)) and self.vertical_exaggeration >= 1):
            raise ValueError('vertical_exaggeration must be "auto" or a number of at least 1')

        if loaded_file.get('show_disclaimer') is None:
            print('show disclaimer set to True (visitors see the disclaimer each time they open the site). If you wish to change this default value, add show_disclaimer to the inputs provided in the JSON file')
            self.show_disclaimer = True
        else:
            self.show_disclaimer = loaded_file.pop('show_disclaimer')

        if loaded_file.get('disclaimer') is None:
            print('disclaimer set to the default text (no warranty, not for navigation, no liability). If you wish to change this default value, add disclaimer to the inputs provided in the JSON file')
            self.disclaimer = {'title': 'Before you use these data', 'paragraphs': [
                'The bathymetry data on this site are raw survey measurements, shared for research and education. They are provided "as is", without warranty of any kind, express or implied, including as to their accuracy, completeness, currency or fitness for any particular purpose.',
                'The data have not been corrected for changes in water level and may contain errors. The interpolated bed in the 3D view is an estimate, not a measurement.',
                'The data must not be used for navigation or for any purpose relating to safety on the water.',
                'We, and the people and institutions involved in collecting and publishing these data, accept no liability for any loss, damage or injury arising from their use or from any errors or omissions in them. You use the data at your own risk and are responsible for deciding whether they suit your purpose.'],
                'button': 'I understand'}
        else:
            self.disclaimer = loaded_file.pop('disclaimer')
        if not isinstance(self.disclaimer.get('paragraphs', []), list):
            raise ValueError('the "paragraphs" of the disclaimer must be a list of texts, one per paragraph')

        if loaded_file.get('bed_max_points') is None:
            print('bed max points set to 250000 per survey day (the grid spacing is widened when a survey would need more). If you wish to change this default value, add bed_max_points to the inputs provided in the JSON file')
            self.bed_max_points = 250000
        else:
            self.bed_max_points = int(loaded_file.pop('bed_max_points'))
        if self.bed_grid_spacing <= 0 or self.bed_max_gap <= 0 or self.bed_max_distance < 0:
            raise ValueError('bed_grid_spacing and bed_max_gap must be larger than zero, and bed_max_distance cannot be negative')

    def setup(self):
        """
        Calls the load_data_from_json method to extract the information provided in the JSON-based document and checks
        that the data and site template directories exist.
        """
        self.load_data_from_json()
        logger.info('Setting up BathymetrySiteBuilder based on the file: "{}"'.format(self.json_file))
        self.check_input_directories()

    def check_input_directories(self):
        """
        Raises an error if the data directory or the site template directory provided in the JSON-based document do not
        exist.
        """
        if not os.path.isdir(self.data_directory):
            raise ValueError('the data directory "{}" does not exist'.format(self.data_directory))
        if not os.path.isdir(self.site_template_directory):
            raise ValueError('the site template directory "{}" does not exist'.format(self.site_template_directory))

    def find_data_files(self):
        """
        Walks through the data directory (including its sub-folders) and returns a sorted list of the files that have
        one of the extensions listed in self.file_extensions.
        """
        extensions = []
        for ex in self.file_extensions:
            extensions.append(ex.lower())
        data_files = []
        for root, dirs, files in os.walk(self.data_directory):
            dirs.sort()
            for fx, file_name in enumerate(sorted(files)):
                if os.path.splitext(file_name)[1].lower() in extensions:
                    data_files.append(os.path.join(root, file_name))
        return data_files

    def line_id_from_path(self, file_path):
        """
        Takes the path of a raw data file and returns an identifier built from its path relative to the data directory.
        The identifier only uses letters, digits, dots, underscores and hyphens so it can be used in file names and in
        website links.
        """
        relative_path = os.path.relpath(file_path, self.data_directory)
        relative_path = os.path.splitext(relative_path)[0]
        line_id = re.sub(r'[^A-Za-z0-9_.-]+', '-', relative_path.replace(os.sep, '__'))
        return line_id.strip('-')

    def line_survey_metadata(self, file_path, file_metadata):
        """
        Returns the survey metadata of one line (platform, sensor and any other entries, such as operator or project).
        The entries are merged in this order, each one overriding the previous: survey_metadata in the JSON-based
        document, then every metadata file (self.metadata_file_name) found from the top of the data directory down to the
        folder of the line, and finally a JSON file with the same name as the line file (for example L0001.json next to
        L0001.dep). When no platform is given, the instrument model recorded in the file header (Antenna Type) is used.
        """
        line_metadata = {}
        for key, value in self.survey_metadata.items():
            line_metadata[key] = value

        folders = [self.data_directory]
        relative_folder = os.path.relpath(os.path.dirname(file_path), self.data_directory)
        if relative_folder != '.':
            for part in relative_folder.split(os.sep):
                folders.append(os.path.join(folders[-1], part))
        for folder in folders:
            metadata_file = os.path.join(folder, self.metadata_file_name)
            if os.path.isfile(metadata_file):
                with open(metadata_file, "r", encoding="utf-8") as f:
                    folder_metadata = json.load(f)
                for key, value in folder_metadata.items():
                    line_metadata[key] = value

        file_metadata_path = os.path.splitext(file_path)[0] + '.json'
        if os.path.isfile(file_metadata_path) and os.path.basename(file_metadata_path) != self.metadata_file_name:
            with open(file_metadata_path, "r", encoding="utf-8") as f:
                own_metadata = json.load(f)
            for key, value in own_metadata.items():
                line_metadata[key] = value

        if line_metadata.get('platform') is None or line_metadata.get('platform') == '':
            line_metadata['platform'] = file_metadata.get('Antenna Type', '')
        if line_metadata.get('sensor') is None:
            line_metadata['sensor'] = ''
        return line_metadata

    def dms_to_decimal(self, value, hemisphere):
        """
        Takes a coordinate written in degrees, minutes and seconds (for example 043°34′43.3273224″) and its hemisphere
        letter (N, S, E or W) and returns the coordinate in signed decimal degrees. Values that are already in decimal
        degrees or in degrees and decimal minutes are also accepted.
        """
        numbers = re.findall(r'[-+]?\d+(?:\.\d+)?', str(value))
        if len(numbers) == 0:
            return np.nan
        decimal_degrees = abs(float(numbers[0]))
        if len(numbers) > 1:
            decimal_degrees = decimal_degrees + float(numbers[1]) / 60.0
        if len(numbers) > 2:
            decimal_degrees = decimal_degrees + float(numbers[2]) / 3600.0
        if str(numbers[0]).startswith('-') or str(hemisphere).strip().upper() in ['S', 'W']:
            decimal_degrees = -decimal_degrees
        return decimal_degrees

    def read_dep_file(self, file_path):
        """
        Reads a CHC .dep file and returns two objects: a dictionary with the survey metadata found in the first header
        row (project name, software version, date, antenna type, draft, sound velocity, etc.), and a DataFrame with the
        soundings, where the coordinates have been converted to decimal degrees and a datetime column has been added.
        """
        with open(file_path, "r", encoding="utf-8-sig") as f:
            lines = f.read().splitlines()

        header_rows = []
        for lx, line in enumerate(lines):
            if line.startswith('//'):
                header_rows.append(lx)
        if len(header_rows) < 2:
            raise ValueError('the file "{}" does not have the two header rows (starting with //) expected in a .dep file'.format(file_path))

        metadata = {}
        metadata_names = lines[header_rows[0]].lstrip('/').split(',')
        metadata_values = lines[header_rows[0] + 1].split(',')
        for mx, metadata_name in enumerate(metadata_names):
            if mx < len(metadata_values):
                metadata[metadata_name.strip()] = metadata_values[mx].strip()

        column_names = []
        for column_name in lines[header_rows[1]].lstrip('/').split(','):
            column_names.append(column_name.strip())
        for required_column in ['Time', 'Latitude', 'N/S', 'Longitude', 'E/W', 'Depth']:
            if required_column not in column_names:
                raise ValueError('the column {} has not been found in the file "{}"'.format(required_column, file_path))

        soundings = pd.read_csv(file_path, skiprows=header_rows[1] + 1, header=None, names=column_names,
                                encoding='utf-8-sig', dtype={'Latitude': str, 'Longitude': str, 'Time': str})

        latitudes = []
        longitudes = []
        for sx in range(len(soundings)):
            latitudes.append(self.dms_to_decimal(soundings['Latitude'].iloc[sx], soundings['N/S'].iloc[sx]))
            longitudes.append(self.dms_to_decimal(soundings['Longitude'].iloc[sx], soundings['E/W'].iloc[sx]))
        soundings['Latitude'] = latitudes
        soundings['Longitude'] = longitudes
        soundings = soundings.drop(columns=['N/S', 'E/W'])

        survey_date = metadata.get('Date')
        if survey_date is None or survey_date == '':
            date_in_name = re.search(r'\d{4}-\d{2}-\d{2}', os.path.basename(file_path))
            if date_in_name is None:
                raise ValueError('the survey date could not be found in the header or the name of the file "{}"'.format(file_path))
            survey_date = date_in_name.group(0)
        metadata['Date'] = survey_date
        soundings['Datetime'] = self.soundings_datetime(survey_date=survey_date, times=soundings['Time'])
        return metadata, soundings

    def soundings_datetime(self, survey_date, times):
        """
        Takes the survey date and the time column of a line and returns a Series of datetimes. A day is added to the
        times that follow a jump back of more than twelve hours, which handles lines that run past midnight.
        """
        datetimes = pd.to_datetime(survey_date + ' ' + times.astype(str), format='%Y-%m-%d %H:%M:%S.%f', errors='coerce')
        time_steps = datetimes.diff().dt.total_seconds()
        rollovers = (time_steps < -12 * 3600).cumsum()
        return datetimes + pd.to_timedelta(rollovers, unit='D')

    def clean_soundings(self, soundings, file_path):
        """
        Removes the soundings that have missing coordinates, missing or non-positive depths, coordinates outside the valid
        range, or a GPS state that is not in self.accepted_gps_states (when this list is not empty). Prints the number of
        soundings removed and returns the cleaned DataFrame.
        """
        number_of_soundings = len(soundings)
        cleaned_soundings = soundings.dropna(subset=['Latitude', 'Longitude', 'Depth', 'Datetime'])
        cleaned_soundings = cleaned_soundings[cleaned_soundings['Depth'] > 0]
        cleaned_soundings = cleaned_soundings[cleaned_soundings['Latitude'].abs() <= 90]
        cleaned_soundings = cleaned_soundings[cleaned_soundings['Longitude'].abs() <= 180]
        if len(self.accepted_gps_states) > 0 and 'GPS State' in cleaned_soundings.columns:
            cleaned_soundings = cleaned_soundings[cleaned_soundings['GPS State'].isin(self.accepted_gps_states)]
        cleaned_soundings = cleaned_soundings.reset_index(drop=True)
        if len(cleaned_soundings) < number_of_soundings:
            print('removed', number_of_soundings - len(cleaned_soundings), 'of', number_of_soundings, 'soundings from', os.path.basename(file_path))
        return cleaned_soundings

    def thin_soundings(self, soundings, maximum_points):
        """
        Takes a DataFrame of soundings and returns every n-th row so that no more than maximum_points rows are kept. The
        last sounding is always kept so the end of the line stays on the map.
        """
        if len(soundings) <= maximum_points:
            return soundings
        stride = int(math.ceil(len(soundings) / float(maximum_points)))
        kept_rows = list(range(0, len(soundings), stride))
        if kept_rows[-1] != len(soundings) - 1:
            kept_rows.append(len(soundings) - 1)
        return soundings.iloc[kept_rows]

    def prepare_output_directory(self):
        """
        Empties the output directory (with self.empty_output_directory) if it was created by a previous build (it then
        contains a .bathymap-build marker file), copies the site template into it, and creates the data sub-folders. Raises an error if the output directory
        exists, is not empty and was not created by this tool, so that no unrelated folder is ever deleted.
        """
        marker_file = os.path.join(self.output_directory, '.bathymap-build')
        if os.path.isdir(self.output_directory) and len(os.listdir(self.output_directory)) > 0:
            if not os.path.isfile(marker_file):
                raise ValueError('the output directory "{}" is not empty and was not created by BathyMap; choose another output_directory'.format(self.output_directory))
            self.empty_output_directory()
        shutil.copytree(self.site_template_directory, self.output_directory, dirs_exist_ok=True)
        for sub_folder in ['points', 'csv', 'raw', 'bed']:
            os.makedirs(os.path.join(self.output_directory, 'data', sub_folder), exist_ok=True)
        with open(marker_file, "w") as f:
            f.write('created by BathyMap on ' + datetime.datetime.now(datetime.timezone.utc).isoformat() + '\n')
        with open(os.path.join(self.output_directory, '.nojekyll'), "w") as f:
            f.write('')

    def empty_output_directory(self):
        """
        Deletes everything inside the output directory but keeps the directory itself. On Windows, OneDrive syncing, an
        open File Explorer window or the preview server can briefly lock files and folders, so each deletion is retried
        for a few seconds and read-only flags are cleared first. Folders that stay locked are left in place, since they
        are empty and harmless. A file that stays locked stops the build with an explanation of what to close.
        """
        for root, dirs, files in os.walk(self.output_directory, topdown=False):
            for file_name in files:
                file_path = os.path.join(root, file_name)
                for attempt in range(10):
                    try:
                        os.chmod(file_path, stat.S_IWRITE)
                        os.remove(file_path)
                        break
                    except PermissionError:
                        if attempt == 9:
                            raise ValueError('the file "{}" is in use and could not be replaced. Stop the preview server (Ctrl+C), close any File Explorer window showing the output folder, wait for OneDrive to finish syncing, and run the build again'.format(file_path))
                        time.sleep(0.5)
            for dir_name in dirs:
                dir_path = os.path.join(root, dir_name)
                for attempt in range(10):
                    try:
                        os.rmdir(dir_path)
                        break
                    except OSError:
                        if attempt == 9:
                            print('could not remove the empty folder', dir_path, '(it is in use); it is left in place')
                        else:
                            time.sleep(0.2)

    def raw_file_link(self, file_path):
        """
        Copies the raw file into the website when self.copy_raw_files is True and returns its relative link. Otherwise
        returns a link to the file in the data folder of the GitHub repository (raw.githubusercontent.com, built from
        self.repository_url and self.repository_branch), or None when repository_url is not a GitHub address.
        """
        relative_path = os.path.relpath(file_path, self.data_directory).replace(os.sep, '/')
        if self.copy_raw_files:
            destination = os.path.join(self.output_directory, 'data', 'raw', os.path.relpath(file_path, self.data_directory))
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copy2(file_path, destination)
            return 'data/raw/' + relative_path
        if self.repository_url.startswith('https://github.com/'):
            owner_and_repository = self.repository_url[len('https://github.com/'):]
            if owner_and_repository.endswith('.git'):
                owner_and_repository = owner_and_repository[:-4]
            data_folder = os.path.relpath(self.data_directory, self.json_file_directory).replace(os.sep, '/')
            return 'https://raw.githubusercontent.com/' + owner_and_repository + '/' + self.repository_branch + '/' + data_folder + '/' + relative_path
        print('copy_raw_files is False and repository_url is not a GitHub address, so', os.path.basename(file_path), 'has no raw download link')
        return None

    def map_variable_values(self, soundings, column, scale=1, from_line_start=False):
        """
        Returns the values of one map variable for the given soundings, multiplied by scale (for example to convert
        radians to degrees) and, when from_line_start is True, minus the value of the first sounding (for example to
        turn a distance counted from the start of the survey session into one counted from the start of the line), or
        None when the soundings do not have it. The column is the name of a column of the raw
        file (for example "Speed"), the difference of two columns written as "A - B" (for example "Height - Depth"),
        or "Time of day", the time of each sounding in seconds after midnight of the survey date.
        """
        values = None
        if column in soundings.columns:
            values = pd.to_numeric(soundings[column], errors='coerce')
        elif column == 'Time of day' and 'Datetime' in soundings.columns and len(soundings) > 0:
            midnight = soundings['Datetime'].iloc[0].normalize()
            values = (soundings['Datetime'] - midnight).dt.total_seconds()
        elif ' - ' in column:
            first_column, second_column = [part.strip() for part in column.split(' - ', 1)]
            if first_column in soundings.columns and second_column in soundings.columns:
                values = pd.to_numeric(soundings[first_column], errors='coerce') - pd.to_numeric(soundings[second_column], errors='coerce')
        if values is not None and from_line_start:
            first_values = values.dropna()
            if len(first_values) > 0:
                values = values - first_values.iloc[0]
        if values is not None and scale != 1:
            values = values * scale
        return values

    def write_line_points(self, line_id, soundings):
        """
        Writes the thinned soundings of one line as a compact JSON file that the map loads, and returns the number of
        points written. The file holds the date and time of the first sounding of the line (start) and parallel arrays
        of latitude, longitude, depth and the time of each sounding in seconds after start (t), from which the website
        rebuilds the full date and time of every sounding. The other map variables of the line (self.map_variables)
        are written under values, keyed by their column.
        """
        map_soundings = self.thin_soundings(soundings=soundings, maximum_points=self.max_map_points_per_line)
        line_start = soundings['Datetime'].iloc[0]
        points = {}
        points['start'] = line_start.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-4]
        points['lat'] = np.round(map_soundings['Latitude'].values, 7).tolist()
        points['lon'] = np.round(map_soundings['Longitude'].values, 7).tolist()
        points['depth'] = np.round(map_soundings['Depth'].values, 3).tolist()
        points['t'] = np.round((map_soundings['Datetime'] - line_start).dt.total_seconds().values, 2).tolist()
        points['values'] = {}
        for map_variable in self.map_variables[1:]:
            if map_variable['column'] == 'Time of day':
                continue    # the website computes it from start and t
            values = self.map_variable_values(soundings=map_soundings, column=map_variable['column'], scale=map_variable.get('scale', 1), from_line_start=map_variable.get('from_line_start', False))
            if values is None:
                continue
            rounded_values = np.round(values.values.astype(float), int(map_variable.get('decimals', 3)) + 1)
            points['values'][map_variable['column']] = [None if np.isnan(value) else float(value) for value in rounded_values]
        fn =os.path.join(self.output_directory, 'data', 'points', line_id + '.json')
        with open(fn, "w") as f:
            json.dump(points, f, separators=(',', ':'))
        return len(map_soundings)

    def write_line_csv(self, line_id, soundings, line_metadata):
        """
        Writes all the cleaned soundings of one line as a CSV file with decimal-degree coordinates, an ISO datetime
        column and the platform and sensor of the line, and appends them to the combined CSV file when
        self.write_combined_csv is True. Returns the CSV soundings.
        """
        csv_soundings = soundings.copy()
        csv_soundings['Platform'] = line_metadata.get('platform', '')
        csv_soundings['Sensor'] = line_metadata.get('sensor', '')
        csv_soundings['Datetime'] = csv_soundings['Datetime'].dt.strftime('%Y-%m-%dT%H:%M:%S.%f').str[:-4]
        csv_soundings['Latitude'] = np.round(csv_soundings['Latitude'], 9)
        csv_soundings['Longitude'] = np.round(csv_soundings['Longitude'], 9)
        first_columns = ['Datetime', 'Latitude', 'Longitude', 'Depth', 'Platform', 'Sensor']
        other_columns = []
        for column_name in csv_soundings.columns:
            if column_name not in first_columns:
                other_columns.append(column_name)
        csv_soundings = csv_soundings[first_columns + other_columns]
        csv_soundings.index.name = 'id'
        fn = os.path.join(self.output_directory, 'data', 'csv', line_id + '.csv')
        csv_soundings.to_csv(fn)
        if self.write_combined_csv:
            combined_soundings = csv_soundings.copy()
            combined_soundings.insert(0, 'Line', line_id)
            combined_fn = os.path.join(self.output_directory, 'data', 'all_lines.csv')
            write_header = not os.path.isfile(combined_fn)
            combined_soundings.to_csv(combined_fn, mode='a', header=write_header, index=False)
        return csv_soundings

    def build_line_record(self, line_id, file_path, metadata, line_metadata, soundings, number_of_map_points, raw_link):
        """
        Returns the dictionary that describes one line in the website index: names, survey date and times, depth
        statistics, bounding box, a simplified track for drawing the line at small scales, the survey metadata (platform,
        sensor and other entries), the instrument settings recorded in the file and the links to the downloadable files.
        """
        track_soundings = self.thin_soundings(soundings=soundings, maximum_points=self.max_track_points_per_line)
        track = []
        for tx in range(len(track_soundings)):
            track.append([round(float(track_soundings['Latitude'].iloc[tx]), 6), round(float(track_soundings['Longitude'].iloc[tx]), 6)])

        record = {}
        record['id'] = line_id
        record['name'] = os.path.splitext(os.path.basename(file_path))[0]
        record['line'] = record['name'].split('_')[0]
        record['folder'] = os.path.relpath(os.path.dirname(file_path), self.data_directory).replace(os.sep, '/')
        record['area'] = metadata.get('Project Name', '')
        record['date'] = metadata.get('Date')
        record['start'] = soundings['Datetime'].min().strftime('%Y-%m-%dT%H:%M:%S')
        record['end'] = soundings['Datetime'].max().strftime('%Y-%m-%dT%H:%M:%S')
        record['points'] = int(len(soundings))
        record['map_points'] = int(number_of_map_points)
        record['depth_min'] = round(float(soundings['Depth'].min()), 3)
        record['depth_max'] = round(float(soundings['Depth'].max()), 3)
        record['depth_mean'] = round(float(soundings['Depth'].mean()), 3)
        record['bbox'] = [round(float(soundings['Longitude'].min()), 7), round(float(soundings['Latitude'].min()), 7),
                          round(float(soundings['Longitude'].max()), 7), round(float(soundings['Latitude'].max()), 7)]
        record['track'] = track
        record['metadata'] = line_metadata
        record['instrument'] = {}
        record['instrument']['antenna_type'] = metadata.get('Antenna Type', '')
        record['instrument']['software_version'] = metadata.get('Version', '')
        record['instrument']['draft_m'] = metadata.get('Draft', '')
        record['instrument']['sound_velocity_m_s'] = metadata.get('Sound Velocity', '')
        if 'GPS State' in soundings.columns:
            gps_state_counts = {}
            for state, count in soundings['GPS State'].value_counts().items():
                gps_state_counts[str(state)] = int(count)
            record['gps_states'] = gps_state_counts
        record['files'] = {}
        record['files']['points'] = 'data/points/' + line_id + '.json'
        record['files']['csv'] = 'data/csv/' + line_id + '.csv'
        record['files']['raw'] = raw_link
        record['files']['raw_name'] = os.path.basename(file_path)
        return record

    def survey_key(self, line_record):
        """
        Returns the key of the survey day a line belongs to (date, area name and location, as the website groups the
        line list) and a file-name-safe identifier made from it.
        """
        location = str(line_record['metadata'].get('location', ''))
        key = '{}|{}|{}'.format(line_record['date'], line_record['area'], location)
        survey_id = re.sub(r'[^A-Za-z0-9_.-]+', '-', '{}__{}__{}'.format(line_record['date'], location, line_record['area'])).strip('-')
        return key, survey_id

    def utm_transformer(self, longitude, latitude):
        """
        Returns the transformers between WGS 84 longitude and latitude and the UTM zone of the given point, used to
        interpolate the bed in metres.
        """
        zone = int((longitude + 180) // 6) + 1
        epsg = (32600 if latitude >= 0 else 32700) + zone
        forward = Transformer.from_crs('EPSG:4326', 'EPSG:{}'.format(epsg), always_xy=True)
        backward = Transformer.from_crs('EPSG:{}'.format(epsg), 'EPSG:4326', always_xy=True)
        return forward, backward, epsg

    def triangle_cells(self, corners_x, corners_y, spacing):
        """
        Returns the grid cells (integer column and row numbers, grid spacing "spacing") of the bounding boxes of the
        given triangles, without repeats. corners_x and corners_y hold the three corners of each triangle (one row per
        triangle). Returns None when there would be more than 50 million cells.
        """
        if len(corners_x) == 0:
            return np.zeros((0, 2), dtype=np.int64)
        column_min = np.floor(corners_x.min(axis=1) / spacing).astype(np.int64)
        column_max = np.ceil(corners_x.max(axis=1) / spacing).astype(np.int64)
        row_min = np.floor(corners_y.min(axis=1) / spacing).astype(np.int64)
        row_max = np.ceil(corners_y.max(axis=1) / spacing).astype(np.int64)
        columns = column_max - column_min + 1
        counts = columns * (row_max - row_min + 1)
        if counts.sum() > 50000000:
            return None
        triangle = np.repeat(np.arange(len(counts)), counts)
        position = np.arange(counts.sum()) - np.repeat(np.cumsum(counts) - counts, counts)
        cells = np.c_[column_min[triangle] + position % columns[triangle], row_min[triangle] + position // columns[triangle]]
        return np.unique(cells, axis=0)

    def interpolate_survey_bed(self, soundings):
        """
        Interpolates the depths of one survey day (or location) onto a regular grid in metres (UTM), linearly inside the
        triangles of a Delaunay triangulation of the soundings. A grid point is kept when it lies
        - inside a triangle that joins two different passes of the survey and whose longest side is at most
          self.bed_max_gap, so the bed is filled between neighbouring passes but not across wide gaps, and never
          beyond the outermost passes (triangles only exist between soundings); or
        - within self.bed_max_distance of a sounding, inside the triangulation (0 by default, so nothing is filled beside
          a lone pass: there, the values would be carried sideways from that pass, pulled by whatever distant sounding
          completes the triangle).
        Two corners of a triangle belong to different passes when they come from different lines, or when the distance
        travelled along the track between them is more than self.bed_pass_ratio times the straight distance between
        them (the boat went away and came back, as between the legs of a back-and-forth survey).
        soundings holds Latitude, Longitude, Depth and Line index (the line of each sounding, in the order sailed).
        The grid spacing is self.bed_grid_spacing, widened when the survey would need more than self.bed_max_points
        points. Returns a dictionary with the grid, the distance from each grid point to the nearest sounding, and the
        projection, or None when the soundings cannot be triangulated (fewer than three, or all on one straight line).
        """
        if len(soundings) < 3:
            return None
        forward, backward, epsg = self.utm_transformer(float(soundings['Longitude'].mean()), float(soundings['Latitude'].mean()))
        easting, northing = forward.transform(soundings['Longitude'].values, soundings['Latitude'].values)
        x0, y0 = float(np.mean(easting)), float(np.mean(northing))
        x, y, z = easting - x0, northing - y0, soundings['Depth'].values.astype(float)
        if 'Line index' in soundings.columns:
            line_index = soundings['Line index'].values
        else:
            line_index = np.zeros(len(x), dtype=int)
        step = np.r_[0.0, np.hypot(np.diff(x), np.diff(y))]
        step[np.r_[True, line_index[1:] != line_index[:-1]]] = 0.0
        along_track = pd.Series(step).groupby(line_index).cumsum().values
        try:
            triangulation = Delaunay(np.c_[x, y])
        except Exception as error:
            print('the bed could not be interpolated:', error)
            return None
        corners = triangulation.simplices
        corners_x, corners_y = x[corners], y[corners]
        longest_side = np.zeros(len(corners))
        between_passes = np.zeros(len(corners), dtype=bool)
        for first, second in [(0, 1), (1, 2), (0, 2)]:
            a, b = corners[:, first], corners[:, second]
            straight = np.hypot(x[a] - x[b], y[a] - y[b])
            longest_side = np.maximum(longest_side, straight)
            different_pass = (line_index[a] != line_index[b]) | (np.abs(along_track[a] - along_track[b]) > self.bed_pass_ratio * straight + 1.0)
            between_passes = between_passes | different_pass
        filled = between_passes & (longest_side <= self.bed_max_gap)
        tree = cKDTree(np.c_[x, y])
        spacing = self.bed_grid_spacing
        while True:
            # Candidate grid cells: the bounding boxes of the filled triangles, and a band around every sounding. Cells
            # are never generated over the whole survey area, so surveys far apart cost nothing for the space between.
            filled_cells = self.triangle_cells(corners_x[filled], corners_y[filled], spacing)
            if self.bed_max_distance > 0:
                reach = int(math.ceil(self.bed_max_distance / spacing))
                offset_i, offset_j = np.meshgrid(np.arange(-reach, reach + 1), np.arange(-reach, reach + 1))
                inside = (offset_i ** 2 + offset_j ** 2) * spacing ** 2 <= (self.bed_max_distance + spacing) ** 2
                offsets = np.c_[offset_i[inside], offset_j[inside]]
                base_cells = np.unique(np.c_[np.round(x / spacing), np.round(y / spacing)].astype(np.int64), axis=0)
            else:
                offsets = np.zeros((0, 2), dtype=np.int64)
                base_cells = np.zeros((0, 2), dtype=np.int64)
            if filled_cells is None or len(base_cells) * len(offsets) > 30000000:
                spacing = spacing * 1.5
                continue
            band_cells = (base_cells[:, None, :] + offsets[None, :, :]).reshape(-1, 2)
            cells = np.unique(np.r_[filled_cells, band_cells], axis=0)
            cell_x, cell_y = cells[:, 0] * spacing, cells[:, 1] * spacing
            triangle = triangulation.find_simplex(np.c_[cell_x, cell_y])
            distance, _ = tree.query(np.c_[cell_x, cell_y])
            in_filled = np.zeros(len(cells), dtype=bool)
            in_filled[triangle >= 0] = filled[triangle[triangle >= 0]]
            keep = (triangle >= 0) & (in_filled | ((self.bed_max_distance > 0) & (distance <= self.bed_max_distance)))
            if keep.sum() <= self.bed_max_points:
                break
            spacing = spacing * 1.5
        if spacing != self.bed_grid_spacing:
            print('the bed grid spacing was widened to', round(spacing, 2), 'm to stay within bed_max_points')
        grid_z = LinearNDInterpolator(triangulation, z)(np.c_[cell_x[keep], cell_y[keep]])
        valid = ~np.isnan(grid_z)
        bed = {}
        bed['x'] = cell_x[keep][valid]
        bed['y'] = cell_y[keep][valid]
        bed['z'] = grid_z[valid]
        bed['distance'] = distance[keep][valid]
        # outline of the surveyed area: every triangle with no side longer than bed_max_gap, filled or not (the holes
        # inside the bed included); the 3D view cuts it out of the basemap and draws the water surface over it
        outline = corners[longest_side <= self.bed_max_gap]
        used, outline_triangles = np.unique(outline.ravel(), return_inverse=True)
        bed['outline'] = {'x': x[used], 'y': y[used], 'triangles': outline_triangles}
        bed['spacing'] = spacing
        bed['origin'] = (x0, y0)
        bed['epsg'] = epsg
        bed['backward'] = backward
        bed['forward'] = forward
        return bed

    def local_georeference(self, bed):
        """
        Returns the affine conversion from longitude and latitude to the local metres of a bed (x east and y north of
        the centre of the survey, in its UTM zone): x = x[0] + x[1] * longitude + x[2] * latitude, and the same for y.
        It is fitted over the bed and a wide margin around it, for placing basemap tiles in the 3D view; over a few
        kilometres it is accurate to a few centimetres.
        """
        x0, y0 = bed['origin']
        span = max(float(bed['x'].max() - bed['x'].min()), float(bed['y'].max() - bed['y'].min()), 100.0)
        sample_x, sample_y = np.meshgrid(np.linspace(bed['x'].min() - 2 * span, bed['x'].max() + 2 * span, 9),
                                         np.linspace(bed['y'].min() - 2 * span, bed['y'].max() + 2 * span, 9))
        longitude, latitude = bed['backward'].transform(sample_x.ravel() + x0, sample_y.ravel() + y0)
        design = np.c_[np.ones(len(longitude)), longitude, latitude]
        coefficients_x = np.linalg.lstsq(design, sample_x.ravel(), rcond=None)[0]
        coefficients_y = np.linalg.lstsq(design, sample_y.ravel(), rcond=None)[0]
        return {'x': [float(c) for c in coefficients_x], 'y': [float(c) for c in coefficients_y]}

    def write_survey_beds(self, line_records, survey_soundings):
        """
        Writes, for each survey day and each named location (all its survey days together), the interpolated bed and
        the soundings drawn with it in the 3D view (data/bed/<survey>.json, coordinates in metres from the centre of
        the survey), and the interpolated bed as a CSV file with latitude, longitude and interpolated depth
        (data/bed/<survey>.csv). Returns the list of beds written, for the index.
        """
        beds = []
        day_keys = [key for key in survey_soundings if survey_soundings[key][0]['kind'] == 'day']
        location_keys = [key for key in survey_soundings if survey_soundings[key][0]['kind'] == 'location']
        for key in day_keys + location_keys:
            parts = survey_soundings[key]
            soundings = pd.concat([part['soundings'].assign(**{'Line index': px}) for px, part in enumerate(parts)], ignore_index=True)
            survey_id = parts[0]['survey_id']
            # a location surveyed on a single day has the same bed as that day: reuse its files
            same_day = [bed_record for bed_record in beds if bed_record['kind'] == 'day' and bed_record['lines'] == [part['line_id'] for part in parts]]
            if parts[0]['kind'] == 'location' and len(same_day) == 1:
                record = dict(same_day[0])
                record['key'] = key
                record['kind'] = 'location'
                beds.append(record)
                print('the bed of', key.replace('|', ' | '), 'is the bed of its only survey day')
                continue
            print('interpolating the bed of', key.replace('|', ' | '), 'from', len(soundings), 'soundings')
            bed = self.interpolate_survey_bed(soundings)
            if bed is None or len(bed['z']) == 0:
                print('no bed was interpolated for', key.replace('|', ' | '))
                continue
            x0, y0 = bed['origin']
            shown = {'x': [], 'y': [], 'z': [], 'line': []}
            line_names = []
            for px, part in enumerate(parts):
                thinned = self.thin_soundings(soundings=part['soundings'], maximum_points=self.max_map_points_per_line)
                easting, northing = bed['forward'].transform(thinned['Longitude'].values, thinned['Latitude'].values)
                shown['x'].extend(np.round(easting - x0, 2).tolist())
                shown['y'].extend(np.round(northing - y0, 2).tolist())
                shown['z'].extend(np.round(thinned['Depth'].values, 3).tolist())
                shown['line'].extend([px] * len(thinned))
                line_names.append(part['line'] if part['kind'] == 'day' else '{} ({})'.format(part['line'], part['date']))
            depths = soundings['Depth'].values
            points = {}
            points['spacing'] = round(bed['spacing'], 3)
            points['max_distance'] = self.bed_max_distance
            points['max_gap'] = self.bed_max_gap
            points['epsg'] = bed['epsg']
            points['range'] = [round(float(np.percentile(depths, 2)), 3), round(float(np.percentile(depths, 98)), 3)]
            points['grid'] = {'x': np.round(bed['x'], 2).tolist(), 'y': np.round(bed['y'], 2).tolist(), 'z': np.round(bed['z'], 3).tolist(),
                              'd': np.round(bed['distance'], 1).tolist()}
            points['soundings'] = shown
            points['lines'] = line_names
            points['georef'] = self.local_georeference(bed=bed)
            points['outline'] = {'x': np.round(bed['outline']['x'], 2).tolist(), 'y': np.round(bed['outline']['y'], 2).tolist(),
                                 'triangles': [int(index) for index in bed['outline']['triangles']]}
            with open(os.path.join(self.output_directory, 'data', 'bed', survey_id + '.json'), 'w') as f:
                json.dump(points, f, separators=(',', ':'))
            longitude, latitude = bed['backward'].transform(bed['x'] + x0, bed['y'] + y0)
            bed_csv = pd.DataFrame({'Latitude': np.round(latitude, 9), 'Longitude': np.round(longitude, 9), 'Interpolated depth': np.round(bed['z'], 3),
                                    'Distance to nearest sounding': np.round(bed['distance'], 2)})
            bed_csv.to_csv(os.path.join(self.output_directory, 'data', 'bed', survey_id + '.csv'), index=False)
            record = {}
            record['key'] = key
            record['id'] = survey_id
            record['kind'] = parts[0]['kind']
            record['lines'] = [part['line_id'] for part in parts]
            record['dates'] = sorted(set([part['date'] for part in parts]))
            record['points'] = int(len(bed['z']))
            record['soundings'] = int(len(soundings))
            record['spacing'] = points['spacing']
            record['files'] = {'points': 'data/bed/' + survey_id + '.json', 'csv': 'data/bed/' + survey_id + '.csv'}
            beds.append(record)
            print('bed points:', len(bed['z']), '| grid spacing:', round(bed['spacing'], 2), 'm | UTM EPSG:', bed['epsg'])
        return beds

    def site_map_variables(self, all_values):
        """
        Returns the map variables offered in the "Colour by" menu of the website, each with the range of its colour
        scale: the range given in the JSON file, or else the 2nd to 98th percentile of all its values. Water depth is
        always kept; any other variable is left out when no line has it or when it has the same value everywhere.
        """
        site_variables = []
        for vx, map_variable in enumerate(self.map_variables):
            column = map_variable['column']
            values = np.array(all_values.get(column, []), dtype=float)
            values = values[~np.isnan(values)]
            if vx > 0 and (len(values) == 0 or values.min() == values.max()):
                print('map variable "{}" is not offered on the map because the data has no varying values for it'.format(column))
                continue
            if map_variable.get('range') is not None:
                colour_range = map_variable['range']
            elif vx == 0 and self.depth_colour_range is not None:
                colour_range = self.depth_colour_range
            elif len(values) > 0:
                colour_range = [float(np.percentile(values, 2)), float(np.percentile(values, 98))]
                if colour_range[0] == colour_range[1]:
                    colour_range = [float(values.min()), float(values.max())]
                if map_variable.get('colours') == 'diverging':
                    half_width = max(abs(colour_range[0]), abs(colour_range[1]))
                    colour_range = [-half_width, half_width]
                colour_range = [round(colour_range[0], 3), round(colour_range[1], 3)]
            else:
                colour_range = [0, 1]
            site_variable = {}
            site_variable['column'] = column
            site_variable['label'] = map_variable.get('label', column)
            site_variable['unit'] = map_variable.get('unit', '')
            site_variable['colours'] = map_variable.get('colours', 'sequential')
            site_variable['decimals'] = int(map_variable.get('decimals', 3))
            site_variable['note'] = map_variable.get('note', '')
            site_variable['group'] = map_variable.get('group', '')
            site_variable['format'] = map_variable.get('format', '')
            site_variable['range'] = colour_range
            site_variables.append(site_variable)
        return site_variables

    def site_settings(self, line_records, all_depths, all_values):
        """
        Returns the dictionary with the website-wide settings written at the top of the index: title, description,
        references, links, the default basemap, the overall bounding box, the depth range used by the colour scale and
        the map variables visitors can colour the soundings by.
        """
        if self.depth_colour_range is None:
            if len(all_depths) > 0:
                depth_range = [round(float(np.percentile(all_depths, 2)), 2), round(float(np.percentile(all_depths, 98)), 2)]
            else:
                depth_range = [0, 1]
        else:
            depth_range = self.depth_colour_range

        overall_bbox = None
        for lx, line_record in enumerate(line_records):
            if overall_bbox is None:
                overall_bbox = list(line_record['bbox'])
            else:
                overall_bbox[0] = min(overall_bbox[0], line_record['bbox'][0])
                overall_bbox[1] = min(overall_bbox[1], line_record['bbox'][1])
                overall_bbox[2] = max(overall_bbox[2], line_record['bbox'][2])
                overall_bbox[3] = max(overall_bbox[3], line_record['bbox'][3])

        settings = {}
        settings['title'] = self.site_title
        settings['description'] = self.site_description
        settings['organisation'] = self.organisation
        settings['contact'] = self.contact
        settings['licence'] = self.licence
        settings['repository_url'] = self.repository_url
        settings['time_reference'] = self.time_reference
        settings['depth_reference'] = self.depth_reference
        settings['height_reference'] = self.height_reference
        settings['depth_colour_range'] = depth_range
        settings['map_variables'] = self.site_map_variables(all_values=all_values)
        settings['default_basemap'] = self.default_basemap
        settings['carto_api_key'] = self.carto_api_key
        settings['start_with_list_collapsed'] = self.start_with_list_collapsed
        settings['bed_max_distance'] = self.bed_max_distance
        settings['bed_max_gap'] = self.bed_max_gap
        settings['vertical_exaggeration'] = self.vertical_exaggeration
        settings['show_disclaimer'] = self.show_disclaimer
        settings['disclaimer'] = self.disclaimer
        settings['bbox'] = overall_bbox
        settings['combined_csv'] = 'data/all_lines.csv' if self.write_combined_csv and len(line_records) > 0 else None
        settings['generated'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        return settings

    def execute(self):
        """
        Builds the website: prepares the output directory, reads and cleans every raw file found in the data directory,
        writes the map points, CSV files and raw copies of each line, and finally writes the index (data/index.json) that
        the website reads. Ends with a reminder to commit and push the output directory.
        """
        t0 = time.time()
        data_files = self.find_data_files()
        print('found', len(data_files), 'raw data files in', self.data_directory)
        self.prepare_output_directory()

        line_records = []
        all_depths = []
        all_values = {}
        survey_soundings = {}
        for fx, file_path in enumerate(data_files):
            print("============================================ processing file " + str(fx + 1) + " of " + str(len(data_files)) + ": " + os.path.relpath(file_path, self.data_directory))
            line_id = self.line_id_from_path(file_path)
            metadata, soundings = self.read_dep_file(file_path)
            line_metadata = self.line_survey_metadata(file_path=file_path, file_metadata=metadata)
            soundings = self.clean_soundings(soundings=soundings, file_path=file_path)
            if len(soundings) == 0:
                print('no valid soundings left in', os.path.basename(file_path), '- the line is skipped')
                continue
            number_of_map_points = self.write_line_points(line_id=line_id, soundings=soundings)
            self.write_line_csv(line_id=line_id, soundings=soundings, line_metadata=line_metadata)
            raw_link = self.raw_file_link(file_path)
            line_records.append(self.build_line_record(line_id=line_id, file_path=file_path, metadata=metadata,
                                                       line_metadata=line_metadata, soundings=soundings,
                                                       number_of_map_points=number_of_map_points,
                                                       raw_link=raw_link))
            all_depths.extend(soundings['Depth'].tolist())
            if self.interpolate_bed:
                # each line belongs to the bed of its survey day and, when it has a location, to the bed of the location
                line_record = line_records[-1]
                part = {'line': line_record['line'], 'line_id': line_record['id'], 'date': line_record['date'],
                        'soundings': soundings[['Latitude', 'Longitude', 'Depth']].reset_index(drop=True)}
                key, survey_id = self.survey_key(line_record)
                survey_soundings.setdefault(key, []).append(dict(part, survey_id=survey_id, kind='day'))
                location = str(line_record['metadata'].get('location', ''))
                if location:
                    location_id = 'location__' + re.sub(r'[^A-Za-z0-9_.-]+', '-', location).strip('-')
                    survey_soundings.setdefault('loc|' + location, []).append(dict(part, survey_id=location_id, kind='location'))
            for map_variable in self.map_variables:
                values = self.map_variable_values(soundings=soundings, column=map_variable['column'], scale=map_variable.get('scale', 1), from_line_start=map_variable.get('from_line_start', False))
                if values is not None:
                    all_values.setdefault(map_variable['column'], []).extend(values.tolist())
            print('location:', line_metadata.get('location', '(none given)'), '| platform:', line_metadata.get('platform'), '| sensor:', line_metadata.get('sensor'))
            print('soundings:', len(soundings), '| map points:', number_of_map_points, '| depth range:',
                  round(soundings['Depth'].min(), 3), 'to', round(soundings['Depth'].max(), 3), 'm')

        index = {}
        index['site'] = self.site_settings(line_records=line_records, all_depths=all_depths, all_values=all_values)
        index['lines'] = line_records
        if self.interpolate_bed:
            print('============================================ interpolating the bed of', len(survey_soundings), 'survey days and locations')
            index['beds'] = self.write_survey_beds(line_records=line_records, survey_soundings=survey_soundings)
        else:
            index['beds'] = []
        fn = os.path.join(self.output_directory, 'data', 'index.json')
        with open(fn, "w") as f:
            json.dump(index, f, separators=(',', ':'))
        print('website written to', self.output_directory, 'with', len(line_records), 'lines in', round((time.time() - t0), 1), 'seconds')
        print('commit and push the data and the', os.path.basename(self.output_directory), 'folder to publish the update')
        return index
