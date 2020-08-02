/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { isEmpty, get } from 'lodash/fp';

import { IndexField } from '../../graphql/types';
import {
  baseCategoryFields,
  getDocumentation,
  getIndexAlias,
  hasDocumentation,
  IndexAlias,
} from '../../utils/beat_schema';
import { FrameworkAdapter, FrameworkRequest } from '../framework';
import { FieldsAdapter, IndexFieldDescriptor } from './types';

export class ElasticsearchIndexFieldAdapter implements FieldsAdapter {
  constructor(private readonly framework: FrameworkAdapter) {}

  public async getIndexFields(request: FrameworkRequest, indices: string[]): Promise<IndexField[]> {
    const indexPatternsService = this.framework.getIndexPatternsService(request);
    const indexesAliasIndices = indices.reduce<Record<string, string[]>>((accumulator, indice) => {
      const key = getIndexAlias(indices, indice);

      if (get(key, accumulator)) {
        accumulator[key] = [...accumulator[key], indice];
      } else {
        accumulator[key] = [indice];
      }
      return accumulator;
    }, {});
    const responsesIndexFields: IndexFieldDescriptor[][] = await Promise.all(
      Object.values(indexesAliasIndices).map((indicesByGroup) =>
        indexPatternsService.getFieldsForWildcard({
          pattern: indicesByGroup,
        })
      )
    );
    return formatIndexFields(
      responsesIndexFields,
      Object.keys(indexesAliasIndices) as IndexAlias[]
    );
  }
}

const missingFields = [
  {
    name: '_id',
    type: 'string',
    searchable: true,
    aggregatable: false,
    readFromDocValues: true,
  },
  {
    name: '_index',
    type: 'string',
    searchable: true,
    aggregatable: true,
    readFromDocValues: true,
  },
];

export const formatIndexFields = (
  responsesIndexFields: IndexFieldDescriptor[][],
  indexesAlias: IndexAlias[]
): IndexField[] =>
  responsesIndexFields
    .reduce(
      (accumulator: IndexField[], indexFields: IndexFieldDescriptor[], indexesAliasIdx: number) => [
        ...accumulator,
        ...[...missingFields, ...indexFields].reduce(
          (itemAccumulator: IndexField[], index: IndexFieldDescriptor) => {
            const alias: IndexAlias = indexesAlias[indexesAliasIdx];
            const splitName = index.name.split('.');
            const category = baseCategoryFields.includes(splitName[0]) ? 'base' : splitName[0];
            return [
              ...itemAccumulator,
              {
                ...(hasDocumentation(alias, index.name) ? getDocumentation(alias, index.name) : {}),
                ...index,
                category,
                indexes: [alias],
              } as IndexField,
            ];
          },
          []
        ),
      ],
      []
    )
    .reduce((accumulator: IndexField[], indexfield: IndexField) => {
      const alreadyExistingIndexField = accumulator.findIndex(
        (acc) => acc.name === indexfield.name
      );
      if (alreadyExistingIndexField > -1) {
        const existingIndexField = accumulator[alreadyExistingIndexField];
        return [
          ...accumulator.slice(0, alreadyExistingIndexField),
          {
            ...existingIndexField,
            description: isEmpty(existingIndexField.description)
              ? indexfield.description
              : existingIndexField.description,
            indexes: Array.from(new Set([...existingIndexField.indexes, ...indexfield.indexes])),
          },
          ...accumulator.slice(alreadyExistingIndexField + 1),
        ];
      }
      return [...accumulator, indexfield];
    }, []);
