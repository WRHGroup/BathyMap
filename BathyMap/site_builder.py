# loading necessary packages
import os
import re
import json
import math
import time
import shutil
import datetime
import numpy as np
import pandas as pd
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
            print('output directory set to "_site". If you wish to change this default value, add output_directory to the inputs provided in the JSON file')
            self.output_directory = os.path.normpath(os.path.join(self.json_file_directory, '_site'))
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
            if os.environ.get('GITHUB_REPOSITORY') is not None:
                self.repository_url = os.environ.get('GITHUB_SERVER_URL', 'https://github.com') + '/' + os.environ.get('GITHUB_REPOSITORY')
            else:
                self.repository_url = ''
            print('repository url set to "{}" (read from GitHub Actions when available). If you wish to change this default value, add repository_url to the inputs provided in the JSON file'.format(self.repository_url))
        else:
            self.repository_url = loaded_file.pop('repository_url')

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
        folder of the line. When no platform is given, the instrument model recorded in the file header (Antenna Type) is
        used.
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
        Empties the output directory if it was created by a previous build (it then contains a .bathymap-build marker
        file), copies the site template into it, and creates the data sub-folders. Raises an error if the output directory
        exists, is not empty and was not created by this tool, so that no unrelated folder is ever deleted.
        """
        marker_file = os.path.join(self.output_directory, '.bathymap-build')
        if os.path.isdir(self.output_directory) and len(os.listdir(self.output_directory)) > 0:
            if not os.path.isfile(marker_file):
                raise ValueError('the output directory "{}" is not empty and was not created by BathyMap; choose another output_directory'.format(self.output_directory))
            shutil.rmtree(self.output_directory)
        shutil.copytree(self.site_template_directory, self.output_directory, dirs_exist_ok=True)
        for sub_folder in ['points', 'csv', 'raw']:
            os.makedirs(os.path.join(self.output_directory, 'data', sub_folder), exist_ok=True)
        with open(marker_file, "w") as f:
            f.write('created by BathyMap on ' + datetime.datetime.now(datetime.timezone.utc).isoformat() + '\n')
        with open(os.path.join(self.output_directory, '.nojekyll'), "w") as f:
            f.write('')

    def raw_file_link(self, file_path):
        """
        Copies the raw file into the website when self.copy_raw_files is True and returns its relative link. Otherwise
        returns a link to the file in the GitHub repository (raw.githubusercontent.com), or None when the repository is
        not known.
        """
        relative_path = os.path.relpath(file_path, self.data_directory).replace(os.sep, '/')
        if self.copy_raw_files:
            destination = os.path.join(self.output_directory, 'data', 'raw', os.path.relpath(file_path, self.data_directory))
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copy2(file_path, destination)
            return 'data/raw/' + relative_path
        if os.environ.get('GITHUB_REPOSITORY') is not None and os.environ.get('GITHUB_SHA') is not None:
            data_folder = os.path.relpath(self.data_directory, self.json_file_directory).replace(os.sep, '/')
            return 'https://raw.githubusercontent.com/' + os.environ.get('GITHUB_REPOSITORY') + '/' + os.environ.get('GITHUB_SHA') + '/' + data_folder + '/' + relative_path
        return None

    def write_line_points(self, line_id, soundings):
        """
        Writes the thinned soundings of one line as a compact JSON file that the map loads, and returns the number of
        points written. The file holds the date and time of the first sounding of the line (start) and parallel arrays
        of latitude, longitude, depth and the time of each sounding in seconds after start (t), from which the website
        rebuilds the full date and time of every sounding.
        """
        map_soundings = self.thin_soundings(soundings=soundings, maximum_points=self.max_map_points_per_line)
        line_start = soundings['Datetime'].iloc[0]
        points = {}
        points['start'] = line_start.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-4]
        points['lat'] = np.round(map_soundings['Latitude'].values, 7).tolist()
        points['lon'] = np.round(map_soundings['Longitude'].values, 7).tolist()
        points['depth'] = np.round(map_soundings['Depth'].values, 3).tolist()
        points['t'] = np.round((map_soundings['Datetime'] - line_start).dt.total_seconds().values, 2).tolist()
        fn = os.path.join(self.output_directory, 'data', 'points', line_id + '.json')
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

    def site_settings(self, line_records, all_depths):
        """
        Returns the dictionary with the website-wide settings written at the top of the index: title, description,
        references, links, the overall bounding box and the depth range used by the colour scale.
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
        settings['depth_colour_range'] = depth_range
        settings['bbox'] = overall_bbox
        settings['combined_csv'] = 'data/all_lines.csv' if self.write_combined_csv and len(line_records) > 0 else None
        settings['generated'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        return settings

    def execute(self):
        """
        Builds the website: prepares the output directory, reads and cleans every raw file found in the data directory,
        writes the map points, CSV files and raw copies of each line, and finally writes the index (data/index.json) that
        the website reads.
        """
        t0 = time.time()
        data_files = self.find_data_files()
        print('found', len(data_files), 'raw data files in', self.data_directory)
        self.prepare_output_directory()

        line_records = []
        all_depths = []
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
            print('platform:', line_metadata.get('platform'), '| sensor:', line_metadata.get('sensor'))
            print('soundings:', len(soundings), '| map points:', number_of_map_points, '| depth range:',
                  round(soundings['Depth'].min(), 3), 'to', round(soundings['Depth'].max(), 3), 'm')

        index = {}
        index['site'] = self.site_settings(line_records=line_records, all_depths=all_depths)
        index['lines'] = line_records
        fn = os.path.join(self.output_directory, 'data', 'index.json')
        with open(fn, "w") as f:
            json.dump(index, f, separators=(',', ':'))
        print('website written to', self.output_directory, 'with', len(line_records), 'lines in', round((time.time() - t0), 1), 'seconds')
        return index
